import axios from 'axios';
import FormData from 'form-data';

const fd = new FormData();
fd.append('file', 'test');

const instance = axios.create();
instance.interceptors.request.use(config => {
  console.log('Headers:', config.headers);
  return config;
});

instance.post('http://localhost', fd, {
  headers: { 'Content-Type': 'multipart/form-data' }
}).catch(() => {});
