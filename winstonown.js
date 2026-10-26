import winston from 'winston';

const isProduction = process.env.NODE_ENV === 'production';

// Egyedi szűrő, ami kiszűri a productionOnly logokat fejlesztői környezetben
const productionOnlyFilter = winston.format((info) => {
    if (info.productionOnly && !isProduction) {
        return false; // Ha nem productionben vagyunk, a log teljesen eldobódik
    }
    return info;
});

// Generáló függvény a szép, tagolt formátumhoz (színek nélkül a fájlokhoz)
const formatLogContent = (info, useColors = false) => {
    const { timestamp, level, message, stack, ...meta } = info;
    const filteredMeta = { ...meta };
    delete filteredMeta[Symbol.for('splat')];
    delete filteredMeta.productionOnly;

    const hasMeta = Object.keys(filteredMeta).length > 0;
    const extra = hasMeta ? ` | meta: ${JSON.stringify(filteredMeta, null, 2)}` : '';
    
    // Ha productionben vagyunk, vagy a lognak volt productionOnly flagje, jelöljük meg
    const prodOnlyTag = (isProduction || info.productionOnly) ? ' [PROD-ONLY]' : '';

    const content = stack || message;
    
    if (useColors) {
        // Konzolhoz színes tagolás (a colorize() miatt a level már tartalmazza a színeket)
        return `[${timestamp}] ${level}${prodOnlyTag}: ${content}${extra}`;
    } else {
        // Fájlokhoz sima fekete-fehér
        return `[${timestamp}] [${level.toUpperCase()}]${prodOnlyTag}: ${content}${extra}`;
    }
};

// 1. Fájlok formátuma (színek nélkül)
const readableFileFormat = winston.format.combine(
    productionOnlyFilter(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf((info) => formatLogContent(info, false))
);

// 2. Konzol formátum (színesen, de ugyanúgy tagoltan)
const consoleFormat = winston.format.combine(
    productionOnlyFilter(),
    winston.format.colorize(),
    winston.format.timestamp({ format: isProduction ? 'YYYY-MM-DD HH:mm:ss' : 'HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf((info) => formatLogContent(info, true))
);

const logger = winston.createLogger({
    level: isProduction ? 'info' : 'debug',
    transports: [
        // 1. Error log fájl
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            format: readableFileFormat
        }),
        // 2. Combined log fájl
        new winston.transports.File({ 
            filename: 'logs/combined.log',
            format: readableFileFormat
        }),
        // 3. Konzol kimenet (színes és tagolt)
        new winston.transports.Console({
            format: consoleFormat
        })
    ]
});

export default logger;