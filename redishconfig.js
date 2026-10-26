import { Redis } from '@upstash/redis';
import 'dotenv/config';

const redis = new Redis({
    url: 'https://amusing-bug-190822.upstash.io',
    token: process.env.REDIS, 
});

export default  redis ;