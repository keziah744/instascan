import os
from datetime import datetime, timedelta

class SecurityConfig:
    # Limites de sécurité
    MAX_REQUESTS_PER_HOUR = 100
    MAX_FOLLOWERS_PER_REQUEST = 50
    MAX_DEPTH = 3
    
    # Horaires d'activité "humaine"
    ACTIVE_HOURS = {
        'start': 8,   # 8h du matin
        'end': 22     # 22h le soir
    }
    
    # Jours d'activité (1=lundi, 7=dimanche)
    ACTIVE_DAYS = [1, 2, 3, 4, 5, 6, 7]  # Tous les jours
    
    @staticmethod
    def is_active_time():
        """Vérifie si c'est un moment approprié pour scraper"""
        now = datetime.now()
        current_hour = now.hour
        current_day = now.weekday() + 1
        
        return (
            SecurityConfig.ACTIVE_HOURS['start'] <= current_hour <= SecurityConfig.ACTIVE_HOURS['end'] and
            current_day in SecurityConfig.ACTIVE_DAYS
        )
    
    @staticmethod
    def get_sleep_duration():
        """Calcule le temps d'attente jusqu'à la prochaine période active"""
        if SecurityConfig.is_active_time():
            return 0
        
        now = datetime.now()
        tomorrow_start = now.replace(hour=SecurityConfig.ACTIVE_HOURS['start'], minute=0, second=0, microsecond=0)
        
        if now.hour >= SecurityConfig.ACTIVE_HOURS['end']:
            tomorrow_start += timedelta(days=1)
        
        sleep_duration = (tomorrow_start - now).total_seconds()
        return sleep_duration