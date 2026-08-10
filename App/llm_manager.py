"""
LLM Manager - unified LLM client supporting multiple providers.

A single static-method class that talks to local (Ollama, LM Studio) and cloud
(OpenAI-compatible, Anthropic, Gemini) providers behind one interface. Local
hosts default to host.docker.internal so a containerised app can reach an LLM
running on the Docker host. Ported and trimmed from the Live Translate project.
"""

import os
import logging

import requests

logger = logging.getLogger(__name__)

OLLAMA_HOST = os.environ.get('OLLAMA_HOST', 'http://host.docker.internal:11434')
LMSTUDIO_HOST = os.environ.get('LMSTUDIO_HOST', 'http://host.docker.internal:1234')


class LLMManager:
    """Unified LLM client supporting multiple providers."""

    NON_CHAT_PATTERNS = [
        'embed', 'text-embedding', 'dall-e', 'dalle', 'whisper',
        'tts', 'text-to-speech', 'moderation', 'rerank', 'classify',
        'summarize', 'detect', 'aya-expanse', 'c4ai-aya',
        'computer-use', 'realtime', 'audio-preview', 'search-preview',
    ]

    CHAT_PATTERNS = [
        'gpt-', 'o1', 'o3', 'chatgpt', 'claude', 'gemini',
        'command', 'deepseek', 'groq', 'grok', 'mistral', 'llama',
        'sonar', 'codestral', 'pixtral', 'ministral',
    ]

    PROVIDER_CONFIGS = {
        'ollama': {
            'type': 'local',
            'models_endpoint': '/api/tags',
            'chat_endpoint': '/api/chat',
        },
        'lmstudio': {
            'type': 'local',
            'models_endpoint': '/v1/models',
            'chat_endpoint': '/v1/chat/completions',
        },
        'openai': {
            'type': 'openai',
            'base_url': 'https://api.openai.com/v1',
            'models_endpoint': '/models',
            'chat_endpoint': '/chat/completions',
        },
        'anthropic': {
            'type': 'anthropic',
            'base_url': 'https://api.anthropic.com/v1',
            'chat_endpoint': '/messages',
        },
        'gemini': {
            'type': 'gemini',
            'base_url': 'https://generativelanguage.googleapis.com/v1beta',
        },
        'deepseek': {
            'type': 'openai',
            'base_url': 'https://api.deepseek.com/v1',
            'models_endpoint': '/models',
            'chat_endpoint': '/chat/completions',
        },
        'cohere': {
            'type': 'openai',
            'base_url': 'https://api.cohere.ai/compatibility/v1',
            'native_models_url': 'https://api.cohere.ai/v1/models',
            'chat_endpoint': '/chat/completions',
        },
        'grok': {
            'type': 'openai',
            'base_url': 'https://api.x.ai/v1',
            'models_endpoint': '/models',
            'chat_endpoint': '/chat/completions',
        },
        'mistral': {
            'type': 'openai',
            'base_url': 'https://api.mistral.ai/v1',
            'models_endpoint': '/models',
            'chat_endpoint': '/chat/completions',
        },
        'perplexity': {
            'type': 'openai',
            'base_url': 'https://api.perplexity.ai',
            'chat_endpoint': '/chat/completions',
        },
    }

    @staticmethod
    def is_local(provider):
        return LLMManager.PROVIDER_CONFIGS.get(provider, {}).get('type') == 'local'

    @staticmethod
    def filter_chat_models(models):
        if not models:
            return models
        filtered = []
        for model_id in models:
            model_lower = model_id.lower()
            is_non_chat = any(p in model_lower for p in LLMManager.NON_CHAT_PATTERNS)
            if is_non_chat:
                continue
            filtered.append(model_id)
        return filtered

    @staticmethod
    def get_base_url(provider, custom_config=None):
        if provider == 'ollama':
            if custom_config:
                protocol = custom_config.get('protocol', 'http')
                host = custom_config.get('host', 'localhost')
                port = custom_config.get('port', 11434)
                return f"{protocol}://{host}:{port}"
            return OLLAMA_HOST
        elif provider == 'lmstudio':
            if custom_config:
                protocol = custom_config.get('protocol', 'http')
                host = custom_config.get('host', 'localhost')
                port = custom_config.get('port', 1234)
                return f"{protocol}://{host}:{port}"
            return LMSTUDIO_HOST
        return LLMManager.PROVIDER_CONFIGS.get(provider, {}).get('base_url', '')

    @staticmethod
    def test_connection(provider, api_key=None, custom_config=None):
        base_url = LLMManager.get_base_url(provider, custom_config)
        try:
            prov_config = LLMManager.PROVIDER_CONFIGS.get(provider, {})
            headers = {'Content-Type': 'application/json', 'User-Agent': 'Cross-Canvas-Art/1.0'}
            if api_key:
                headers['Authorization'] = f'Bearer {api_key}'

            if provider == 'ollama':
                endpoint = f"{base_url}/api/tags"
            elif provider == 'lmstudio':
                endpoint = f"{base_url}/v1/models"
            elif provider == 'anthropic':
                endpoint = f"{base_url}/models"
                headers['x-api-key'] = api_key or ''
                headers['anthropic-version'] = '2023-06-01'
                headers.pop('Authorization', None)
            elif provider == 'gemini':
                endpoint = f"{base_url}/models?key={api_key or ''}"
            elif 'models_endpoint' in prov_config:
                endpoint = f"{base_url}{prov_config['models_endpoint']}"
            else:
                endpoint = f"{base_url}{prov_config.get('chat_endpoint', '/chat/completions')}"
                test_payload = {
                    'model': 'test-model',
                    'messages': [{'role': 'user', 'content': 'test'}],
                    'max_tokens': 1,
                }
                response = requests.post(endpoint, json=test_payload, headers=headers, timeout=5)
                return {
                    'connected': response.status_code < 500,
                    'status_code': response.status_code,
                    'url': endpoint,
                    'error': None if response.status_code < 500 else f"HTTP {response.status_code}",
                }

            response = requests.get(endpoint, headers=headers, timeout=5)
            return {
                'connected': response.ok,
                'status_code': response.status_code,
                'url': endpoint,
                'error': None if response.ok else f"HTTP {response.status_code}",
            }
        except requests.exceptions.Timeout:
            return {'connected': False, 'status_code': None, 'url': base_url, 'error': 'Connection timeout'}
        except requests.exceptions.ConnectionError as exc:
            return {'connected': False, 'status_code': None, 'url': base_url, 'error': f'Connection refused: {exc}'}
        except Exception as exc:  # noqa: BLE001
            return {'connected': False, 'status_code': None, 'url': base_url, 'error': str(exc)}

    @staticmethod
    def list_models(provider, api_key=None, custom_config=None):
        try:
            base_url = LLMManager.get_base_url(provider, custom_config)
            prov_config = LLMManager.PROVIDER_CONFIGS.get(provider, {})
            headers = {'Content-Type': 'application/json', 'User-Agent': 'Cross-Canvas-Art/1.0'}
            if api_key:
                headers['Authorization'] = f'Bearer {api_key}'

            if provider == 'ollama':
                response = requests.get(f"{base_url}/api/tags", headers=headers, timeout=10)
                response.raise_for_status()
                data = response.json()
                return {'models': [m['name'] for m in data.get('models', [])], 'error': None}

            elif provider == 'lmstudio':
                response = requests.get(f"{base_url}/v1/models", headers=headers, timeout=10)
                response.raise_for_status()
                data = response.json()
                return {'models': [m['id'] for m in data.get('data', [])], 'error': None}

            elif provider == 'anthropic':
                if not api_key:
                    return {'models': [], 'error': 'API key required'}
                headers['x-api-key'] = api_key
                headers['anthropic-version'] = '2023-06-01'
                headers.pop('Authorization', None)
                response = requests.get(f"{base_url}/models", headers=headers, timeout=10)
                response.raise_for_status()
                data = response.json()
                models = []
                if isinstance(data.get('data'), list):
                    models = [m['id'] for m in data['data'] if m.get('id')]
                elif isinstance(data.get('models'), list):
                    models = [m.get('id') or m.get('name') for m in data['models'] if m.get('id') or m.get('name')]
                return {'models': models, 'error': None}

            elif provider == 'gemini':
                response = requests.get(f"{base_url}/models?key={api_key}", headers=headers, timeout=10)
                response.raise_for_status()
                data = response.json()
                models = []
                for m in data.get('models', []):
                    name = m.get('name', '')
                    model_id = name.split('/')[-1] if '/' in name else name
                    if model_id:
                        models.append(model_id)
                return {'models': LLMManager.filter_chat_models(models), 'error': None}

            elif provider == 'cohere':
                if not api_key:
                    return {'models': [], 'error': 'API key required'}
                native_url = prov_config.get('native_models_url', 'https://api.cohere.ai/v1/models')
                response = requests.get(native_url, headers=headers, timeout=10)
                response.raise_for_status()
                data = response.json()
                models = [m.get('name') or m.get('id') for m in data.get('models', []) if m.get('name') or m.get('id')]
                return {'models': LLMManager.filter_chat_models(models), 'error': None}

            else:
                models_endpoint = prov_config.get('models_endpoint')
                if not models_endpoint:
                    return {'models': [], 'error': None}
                response = requests.get(f"{base_url}{models_endpoint}", headers=headers, timeout=10)
                response.raise_for_status()
                data = response.json()
                models = [m.get('id') for m in data.get('data', []) if m.get('id')]
                return {'models': LLMManager.filter_chat_models(models), 'error': None}

        except requests.exceptions.Timeout:
            return {'models': [], 'error': 'Request timed out'}
        except requests.exceptions.ConnectionError:
            return {'models': [], 'error': 'Connection failed - server unreachable'}
        except Exception as exc:  # noqa: BLE001
            return {'models': [], 'error': str(exc)}

    @staticmethod
    def chat(provider, messages, model, api_key=None, custom_config=None,
             temperature=0.7, max_tokens=2000):
        try:
            base_url = LLMManager.get_base_url(provider, custom_config)
            config_data = LLMManager.PROVIDER_CONFIGS.get(provider, {})
            headers = {'Content-Type': 'application/json', 'User-Agent': 'Cross-Canvas-Art/1.0'}
            timeout = 180

            if provider == 'ollama':
                endpoint = f"{base_url}/api/chat"
                # num_predict = output token limit; num_ctx = total context window.
                # Without these Ollama uses its own tiny defaults and truncates output.
                payload = {
                    'model': model,
                    'messages': messages,
                    'stream': False,
                    'options': {
                        'num_predict': max_tokens,
                        'temperature': temperature,
                        'num_ctx': max(8192, max_tokens + 2048),
                    },
                }
                response = requests.post(endpoint, json=payload, headers=headers, timeout=timeout)
                if response.ok:
                    data = response.json()
                    return {'success': True, 'content': data.get('message', {}).get('content', '')}

            elif provider == 'anthropic':
                endpoint = f"{base_url}/messages"
                headers['x-api-key'] = api_key
                headers['anthropic-version'] = '2023-06-01'
                system_msg = next((m['content'] for m in messages if m['role'] == 'system'), '')
                user_messages = [m for m in messages if m['role'] != 'system']
                payload = {
                    'model': model, 'messages': user_messages,
                    'system': system_msg, 'max_tokens': max_tokens, 'temperature': temperature,
                }
                response = requests.post(endpoint, json=payload, headers=headers, timeout=timeout)
                if response.ok:
                    data = response.json()
                    content = data.get('content', [{}])[0].get('text', '')
                    return {'success': True, 'content': content}

            elif provider == 'gemini':
                endpoint = f"{base_url}/models/{model}:generateContent?key={api_key}"
                parts = [{'text': f"{m['role']}: {m['content']}"} for m in messages]
                payload = {
                    'contents': [{'parts': parts}],
                    'generationConfig': {'maxOutputTokens': max_tokens, 'temperature': temperature},
                }
                response = requests.post(endpoint, json=payload, headers=headers, timeout=timeout)
                if response.ok:
                    data = response.json()
                    content = data.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
                    return {'success': True, 'content': content}

            else:
                if api_key:
                    headers['Authorization'] = f'Bearer {api_key}'
                chat_endpoint = config_data.get('chat_endpoint', '/chat/completions')
                endpoint = f"{base_url}{chat_endpoint}"
                payload = {
                    'model': model, 'messages': messages,
                    'max_tokens': max_tokens, 'temperature': temperature,
                }
                response = requests.post(endpoint, json=payload, headers=headers, timeout=timeout)
                if response.ok:
                    data = response.json()
                    content = data.get('choices', [{}])[0].get('message', {}).get('content', '')
                    return {'success': True, 'content': content}

            error_msg = f"HTTP {response.status_code}"
            try:
                error_data = response.json()
                if 'error' in error_data:
                    if isinstance(error_data['error'], dict):
                        error_msg = error_data['error'].get('message', error_msg)
                    else:
                        error_msg = str(error_data['error'])
                elif 'message' in error_data:
                    error_msg = error_data['message']
            except Exception:  # noqa: BLE001
                status_code = response.status_code
                if status_code == 404:
                    error_msg = f"Model '{model}' not found."
                elif status_code == 401:
                    error_msg = "Authentication failed. Check your API key."
                elif status_code == 403:
                    error_msg = f"Access denied to model '{model}'."
                elif status_code == 429:
                    error_msg = "Rate limit exceeded. Please wait and try again."

            return {'success': False, 'error': error_msg}

        except requests.exceptions.Timeout:
            return {'success': False, 'error': 'Request timed out'}
        except requests.exceptions.ConnectionError:
            return {'success': False, 'error': 'Connection failed - server unreachable'}
        except Exception as exc:  # noqa: BLE001
            return {'success': False, 'error': str(exc)}
