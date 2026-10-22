"""Bounded in-memory declarative phone job queue."""
import asyncio
import secrets
import time

TERMINAL = {'succeeded', 'failed', 'cancelled'}


class JobQueue:
    def __init__(self, acquire, event, *, total_limit=64, owner_limit=16,
                 wait_seconds=60, retention=3600, max_completed=256):
        self.acquire, self.event = acquire, event
        self.total_limit, self.owner_limit = total_limit, owner_limit
        self.wait_seconds, self.retention, self.max_completed = wait_seconds, retention, max_completed
        self.jobs, self.tasks = {}, {}
        self.lock = asyncio.Lock()
        self.stopping = False

    def _prune(self):
        now = time.time()
        completed = [((j['finished_at'] or j['created_at']), jid) for jid, j in self.jobs.items() if j['state'] in TERMINAL]
        for _, jid in sorted(completed):
            if now - (self.jobs[jid]['finished_at'] or self.jobs[jid]['created_at']) > self.retention or len(completed) > self.max_completed:
                self.jobs.pop(jid, None); self.tasks.pop(jid, None); completed.pop(0)

    async def submit(self, owner, device_id, ttl, steps, name=None):
        async with self.lock:
            self._prune()
            active = [j for j in self.jobs.values() if j['state'] not in TERMINAL]
            if self.stopping or len(active) >= self.total_limit or sum(j['owner'] == owner for j in active) >= self.owner_limit:
                raise RuntimeError('Job queue is full')
            jid, token = secrets.token_urlsafe(18), secrets.token_urlsafe(32)
            job = {'id': jid, 'owner': owner, '_token': token, 'name': name, 'device_id': device_id,
                   'state': 'queued', 'cleanup': 'pending', 'step': 0, 'steps': len(steps),
                   'error': None, 'created_at': time.time(), 'started_at': None, 'finished_at': None,
                   '_runner_started': False}
            self.jobs[jid] = job
            self.tasks[jid] = asyncio.create_task(self._run(job, ttl, steps), name='strowger-job-' + jid)
            return {'id': jid, 'job_token': token, **self.public(job)}

    def public(self, job):
        return {k: job[k] for k in ('id', 'name', 'device_id', 'state', 'cleanup', 'step', 'steps',
                                    'error', 'created_at', 'started_at', 'finished_at')}

    async def _run(self, job, ttl, steps):
        job['_runner_started'] = True
        lease = None
        outcome = 'failed'
        try:
            if job['state'] == 'cancelled':
                outcome = 'cancelled'
                return
            deadline = time.monotonic() + self.wait_seconds
            while lease is None:
                try:
                    lease = await self.acquire(job['owner'], job['device_id'], ttl)
                except Exception as e:
                    status = getattr(e, 'status_code', None)
                    if status == 503 or status not in (409,) or time.monotonic() >= deadline:
                        job['error'] = 'device_unavailable' if status in (409, 503) else 'acquire_failed'
                        job['_acquire_cleanup'] = getattr(e, 'cleanup_state', 'released')
                        outcome = 'failed'
                        return
                    await asyncio.sleep(.2)
            if job['state'] == 'cancelling': raise asyncio.CancelledError()
            job['state'] = 'running'; job['started_at'] = time.time()
            for index, step in enumerate(steps, 1):
                if job['state'] == 'cancelling':
                    raise asyncio.CancelledError()
                job['step'] = index
                await lease._job_act(step['action'], step['args'])
            outcome = 'succeeded'
        except asyncio.CancelledError as exc:
            outcome = 'cancelled'
            if lease is None:
                job['_acquire_cleanup'] = getattr(exc, 'cleanup_state', 'released')
        except Exception as exc:
            job['error'] = 'action_failed'
            outcome = 'failed'
            if lease is None:
                job['_acquire_cleanup'] = getattr(exc, 'cleanup_state', 'released')
        finally:
            if lease is not None:
                try:
                    cleanup_task = asyncio.create_task(lease._release_internal())
                    try: await asyncio.shield(cleanup_task)
                    except asyncio.CancelledError: await cleanup_task
                    if lease.state not in ('released', 'expired'):
                        raise RuntimeError('Lease cleanup was not confirmed')
                    job['cleanup'] = 'released'
                except Exception:
                    job['cleanup'] = 'quarantined'
                    if outcome == 'succeeded':
                        job['error'] = 'cleanup_failed'
                        outcome = 'failed'
            else:
                job['cleanup'] = job.get('_acquire_cleanup', 'released')
            if job['state'] == 'cancelling': outcome = 'cancelled'
            job['state'] = outcome
            job['finished_at'] = time.time()
            self.event(job, 'finished')

    def get(self, jid, owner, token):
        self._prune()
        j = self.jobs.get(jid)
        import hmac
        if j is None or j['owner'] != owner or not hmac.compare_digest((token or '').encode(), j['_token'].encode()):
            return None
        return j

    async def cancel(self, job):
        if job['state'] in TERMINAL or job['state'] == 'cancelling':
            return
        if job['state'] == 'queued' and not job['_runner_started']:
            job['state'], job['cleanup'], job['finished_at'] = 'cancelled', 'released', time.time()
            task = self.tasks.get(job['id'])
            if task and not task.done(): task.cancel()
            return
        job['state'] = 'cancelling'
        task = self.tasks.get(job['id'])
        if task and not task.done():
            task.cancel()

    async def shutdown(self):
        self.stopping = True
        tasks = list(self.tasks.values())
        for job in self.jobs.values():
            if job['state'] not in TERMINAL and job['state'] != 'cancelling':
                if job['state'] == 'queued' and not job['_runner_started']:
                    job['state'], job['cleanup'], job['finished_at'] = 'cancelled', 'released', time.time()
                else:
                    job['state'] = 'cancelling'
        for task in tasks:
            if not task.done(): task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
