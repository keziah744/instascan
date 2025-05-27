import random
import requests
import time

class ProxyManager:
    def __init__(self):
        self.proxies = [
            # Ajoutez vos proxies ici au format:
            # {'http': 'http://proxy:port', 'https': 'https://proxy:port'}
        ]
        self.current_proxy_index = 0
    
    def get_proxy(self):
        """Retourne un proxy aléatoire"""
        if not self.proxies:
            return None
        return random.choice(self.proxies)
    
    def rotate_proxy(self):
        """Change de proxy"""
        if not self.proxies:
            return None
        self.current_proxy_index = (self.current_proxy_index + 1) % len(self.proxies)
        return self.proxies[self.current_proxy_index]
    
    def test_proxy(self, proxy):
        """Test si un proxy fonctionne"""
        try:
            response = requests.get('https://httpbin.org/ip', proxies=proxy, timeout=10)
            return response.status_code == 200
        except:
            return False