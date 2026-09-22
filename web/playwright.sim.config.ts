import { browserConfig } from './tests/browser-config';
export default browserConfig(true, process.env.SIM_OFFLINE === '1');
