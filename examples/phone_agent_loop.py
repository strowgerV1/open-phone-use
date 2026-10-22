"""Observation/action loop with an injected decision function.

Connect your own approved model client inside ``decide``. Give it the
observation and the action schema, never the broker key, serial, or shell.
This runnable example uses a human JSON decision callback as a transparent
stand-in; it does not claim to connect to an LLM.
"""
import asyncio
import json
import os

from strowger_env.async_client import AsyncRuntime


ALLOWED = {'tap', 'key', 'swipe', 'type', 'open_app', 'hierarchy',
           'ui_click', 'ui_exists', 'ui_set_text'}


async def human_decision(observation):
    print('Observation:', json.dumps(observation, ensure_ascii=False)[:1600])
    raw = await asyncio.to_thread(input, 'Action JSON or stop: ')
    if raw.strip().lower() == 'stop':
        return None
    decision = json.loads(raw)
    if not isinstance(decision, dict) or decision.get('action') not in ALLOWED or not isinstance(decision.get('args', {}), dict):
        raise ValueError('Expected a permitted action and args object')
    return decision


async def run(decide, max_steps=10):
    owner = os.environ['ENV_PHONE_OWNER']
    api_key = json.loads(os.environ['ENV_API_KEYS'])[owner]
    async with AsyncRuntime(os.environ.get('ENV_BROKER_URL', 'http://127.0.0.1:8876'), api_key) as runtime:
        async with await runtime.phone.acquire(ttl=180) as phone:
            for _ in range(max_steps):
                observation = await phone.act('observe')
                choice = await decide(observation)
                if choice is None:
                    break
                await phone.act(choice['action'], **choice.get('args', {}))


if __name__ == '__main__':
    asyncio.run(run(human_decision))
