#!/usr/bin/env bash
set -euo pipefail

# Prepare operator tooling from a pinned source revision. The script does not
# create cloud hosts or CVDs and does not install an on-prem orchestration
# service. That deployment is configured separately using Google's guide.

readonly REPO_URL='https://github.com/google/cloud-android-orchestration.git'
readonly REPO_COMMIT='4de2e0453682f91d6beb39b29f7c3fb06b9cb094'
readonly GO_VERSION='1.27.3'
readonly DEFAULT_SOURCE_DIR='build/cuttlefish/cloud-android-orchestration'
readonly DEFAULT_GO_DIR='build/cuttlefish/go1.27.3'
readonly DEFAULT_BIN_DIR='/usr/local/bin'

usage() {
  cat <<'EOF'
Usage: prepare-cuttlefish-host.sh [--apply] [--source-dir PATH] [--go-dir PATH] [--bin-dir PATH]

Default mode prints host diagnostics and the pinned build plan only.
--apply installs Git/curl prerequisites if needed, downloads a checksum-verified
Go toolchain into the project build directory, adds the current user to the
existing kvm group when needed, checks out the pinned cvdr source, builds it,
and installs the executable. It does not reboot or create cloud resources.
EOF
}

apply=0
source_dir="$DEFAULT_SOURCE_DIR"
go_dir="$DEFAULT_GO_DIR"
bin_dir="$DEFAULT_BIN_DIR"
while (($#)); do
  case "$1" in
    --apply) apply=1; shift ;;
    --source-dir)
      (($# >= 2)) || { usage >&2; exit 2; }
      source_dir="$2"; shift 2 ;;
    --go-dir)
      (($# >= 2)) || { usage >&2; exit 2; }
      go_dir="$2"; shift 2 ;;
    --bin-dir)
      (($# >= 2)) || { usage >&2; exit 2; }
      bin_dir="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

# Keep all configured paths valid after the build changes directory into the
# pinned source checkout. This also lets callers choose relative paths safely.
invocation_dir="$(pwd -P)"
case "$source_dir" in /*) ;; *) source_dir="$invocation_dir/$source_dir" ;; esac
case "$go_dir" in /*) ;; *) go_dir="$invocation_dir/$go_dir" ;; esac
case "$bin_dir" in /*) ;; *) bin_dir="$invocation_dir/$bin_dir" ;; esac

if [[ "$(uname -s)" != 'Linux' ]]; then
  printf 'Client use is possible, but this operating system cannot host Cuttlefish with KVM.\n'
  printf 'No system changes were made.\n'
  exit 2
fi

if [[ ! -e /dev/kvm ]]; then
  printf '/dev/kvm is absent; this machine cannot host Cuttlefish.\n' >&2
  printf 'No system changes were made.\n' >&2
  exit 2
fi

if [[ -r /dev/kvm && -w /dev/kvm ]]; then
  printf 'KVM: /dev/kvm is present and readable/writable by %s.\n' "$(id -un)"
else
  printf 'KVM: /dev/kvm exists, but %s lacks read/write access.\n' "$(id -un)"
  printf 'The apply step can add this account to the existing kvm group; a new login is required.\n'
fi

if [[ ! -r /etc/os-release ]]; then
  printf 'Cannot identify the Linux distribution; host preparation supports Debian/Ubuntu only.\n' >&2
  exit 2
fi
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}:${ID_LIKE:-}" in
  debian:*|ubuntu:*|*:debian*|*:ubuntu*) printf 'Distribution: %s\n' "${PRETTY_NAME:-Linux}" ;;
  *) printf 'Host preparation supports Debian/Ubuntu only; found %s.\n' "${PRETTY_NAME:-Linux}" >&2; exit 2 ;;
esac

printf 'cvdr source revision: %s\n' "$REPO_COMMIT"
printf 'Go toolchain: %s (go.mod requires Go 1.22 or later)\n' "$GO_VERSION"
printf 'Source checkout: %s\n' "$source_dir"
printf 'Go install directory: %s\n' "$go_dir"
printf 'Install directory: %s\n' "$bin_dir"
for tool in git go adb; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '%s: %s\n' "$tool" "$(command -v "$tool")"
  else
    printf '%s: absent\n' "$tool"
  fi
done

if (( ! apply )); then
  printf 'Diagnostic mode only. Pass --apply to install operator tooling.\n'
  exit 0
fi

if ! command -v sudo >/dev/null 2>&1; then
  printf 'sudo is required for apt and group updates.\n' >&2
  exit 2
fi

if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl git tar coreutils
fi

if ! getent group kvm >/dev/null 2>&1; then
  printf 'The kvm group is absent. Configure the host KVM package/device first, then retry.\n' >&2
  exit 2
fi

if ! id -nG "$(id -un)" | tr ' ' '\n' | grep -Fxq kvm; then
  sudo usermod -aG kvm "$(id -un)"
  printf 'Added %s to the existing kvm group; log out and back in before using KVM.\n' "$(id -un)"
fi

source_parent="$(dirname "$source_dir")"
mkdir -p "$source_parent"
if [[ -e "$source_dir" ]]; then
  if ! git -C "$source_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf 'Source directory already exists and is not a Git checkout: %s\n' "$source_dir" >&2
    exit 2
  fi
  remote_url="$(git -C "$source_dir" remote get-url origin 2>/dev/null || true)"
  case "$remote_url" in
    "$REPO_URL"|git@github.com:google/cloud-android-orchestration.git) ;;
    *) printf 'Existing checkout has an unexpected origin: %s\n' "$remote_url" >&2; exit 2 ;;
  esac
  current_commit="$(git -C "$source_dir" rev-parse HEAD)"
  if [[ "$current_commit" != "$REPO_COMMIT" ]]; then
    printf 'Existing checkout is at %s, expected %s. Select another --source-dir.\n' "$current_commit" "$REPO_COMMIT" >&2
    exit 2
  fi
  if [[ -n "$(git -C "$source_dir" status --porcelain --ignored --untracked-files=all)" ]]; then
    printf 'Existing checkout has local, untracked, or ignored files: %s\n' "$source_dir" >&2
    exit 2
  fi
else
  git clone --filter=blob:none --no-checkout "$REPO_URL" "$source_dir"
  git -C "$source_dir" fetch --depth=1 origin "$REPO_COMMIT"
  git -C "$source_dir" checkout --detach FETCH_HEAD
  current_commit="$(git -C "$source_dir" rev-parse HEAD)"
  if [[ "$current_commit" != "$REPO_COMMIT" ]]; then
    printf 'Pinned source checkout verification failed.\n' >&2
    exit 2
  fi
fi

case "$(uname -m)" in
  x86_64|amd64)
    go_arch='amd64'
    go_sha256='65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40' ;;
  aarch64|arm64)
    go_arch='arm64'
    go_sha256='a06e99309dbcbdca1a8ccd2282c3ee146e55930886e26b4f1193269587165f49' ;;
  *) printf 'No pinned Go %s archive is configured for architecture %s.\n' "$GO_VERSION" "$(uname -m)" >&2; exit 2 ;;
esac

go_bin="$go_dir/bin/go"
if [[ -x "$go_bin" ]]; then
  actual_go_version="$("$go_bin" version)"
  if [[ "$actual_go_version" != *"go$GO_VERSION"* ]]; then
    printf 'Existing Go toolchain is not go%s: %s\n' "$GO_VERSION" "$go_dir" >&2
    exit 2
  fi
else
  if [[ -e "$go_dir" ]]; then
    printf 'Go destination exists without a validated toolchain: %s\n' "$go_dir" >&2
    exit 2
  fi
  archive="$(mktemp)"
  stage="$(mktemp -d)"
  trap 'rm -f "$archive"; rm -rf "$stage"' EXIT
  curl --fail --location --silent --show-error \
    "https://go.dev/dl/go${GO_VERSION}.linux-${go_arch}.tar.gz" -o "$archive"
  printf '%s  %s\n' "$go_sha256" "$archive" | sha256sum --check --status || {
    printf 'Go archive checksum verification failed.\n' >&2
    exit 2
  }
  tar -C "$stage" -xzf "$archive"
  mkdir -p "$(dirname "$go_dir")"
  mv "$stage/go" "$go_dir"
  rm -f "$archive"
  rmdir "$stage"
  trap - EXIT
fi

tmp_bin="$(mktemp)"
trap 'rm -f "$tmp_bin"' EXIT
cd "$source_dir"
GOTOOLCHAIN=local "$go_bin" build -mod=readonly -o "$tmp_bin" ./cmd/cvdr
sudo install -d -m 0755 "$bin_dir"
sudo install -m 0755 "$tmp_bin" "$bin_dir/cvdr"

printf 'Installed cvdr built from %s at %s/cvdr.\n' "$REPO_COMMIT" "$bin_dir"
printf 'Supply CVDR_USER_CONFIG_PATH to an existing private cvdr.toml; this script does not create cloud credentials.\n'
printf 'No CVD or cloud host was created. Configure the Cloud Android Orchestration service before running cvdr create.\n'
