
import redis from '../redishconfig.js';


export const setPolling = async (id, value) =>{

    await redis.set(`polling:sub:${id}`, value, { ex: 60 });

}

export const getPolling = async (id) =>{

    return await redis.get(`polling:sub:${id}`);

}
