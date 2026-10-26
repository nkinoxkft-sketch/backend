import fs from 'fs';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bold: '\x1b[1m'
};

const typeColors = {
  reset: '\x1b[0m',
  validator: '\x1b[32m',
  limiter: '\x1b[32m',
  payment: '\x1b[34m',
  get: '\x1b[33m',
  update: '\x1b[33m',
  database: '\x1b[31m',
  invoice: '\x1b[31m',
  login: '\x1b[31m',
  delete: '\x1b[31m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  access: '\x1b[33m',
};

export const serverLog = (type) => {
  return {
    log(option, msg) {

        const time = new Date().toLocaleTimeString();
        console.log(`${colors.gray}[${time}]${colors.reset} ${typeColors[type]}${colors.bold}[${option}]${colors.reset} ${msg}`);
        fs.appendFileSync('./logs/server.log', `${colors.gray}[${time}]${colors.reset} ${typeColors[type]}${colors.bold}[${option}]${colors.reset} ${msg}`);

    }
  };
};

