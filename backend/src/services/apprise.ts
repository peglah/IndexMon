import axios from 'axios';

export const sendAlert = async (message: string) => {
  const appriseUrls = process.env.APRISE_URLS?.split(',').filter(Boolean) || [];
  if (!appriseUrls.length) return;

  try {
    await Promise.all(
      appriseUrls.map((url) =>
        axios.post(url, { body: message, title: 'Indexer Alert' })
      )
    );
  } catch (error) {
    console.error('Failed to send alert:', error);
  }
};