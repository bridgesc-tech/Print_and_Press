// OpenWeatherMap API Configuration
// Get your free API key from: https://openweathermap.org/api
// Sign up at https://home.openweathermap.org/users/sign_up
// Free tier includes 1,000 API calls per day
const WEATHER_API_KEY = '510078f5974e66dd498568c74dc2aa7f';

// Make API key available globally
if (typeof window !== 'undefined') {
    window.WEATHER_API_KEY = WEATHER_API_KEY;
    console.log('Weather API key loaded:', WEATHER_API_KEY ? 'Yes' : 'No');
}

