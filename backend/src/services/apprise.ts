import axios from 'axios';

export const sendAlert = async (message: string) => {
  const urls = process.env.APPRISE_URLS?.split(',').filter(Boolean) || [];
  if (!urls.length) return;

  const apiUrl = process.env.APPRISE_API_URL;
  if (!apiUrl) {
    console.warn('APPRISE_API_URL not set — skipping alert(s)');
    return;
  }

  try {
    await axios.post(`${apiUrl.replace(/\/$/, '')}/notify`, {
      urls: urls.join(','),
      body: message,
      title: 'Indexer Alert',
    });
  } catch (error) {
    console.error('Failed to send alert:', error);
  }
};
