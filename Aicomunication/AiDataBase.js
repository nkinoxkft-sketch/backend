import { prisma } from '../database.js';

export const addMessage = async (user_id, prompt, message, session_crypted, used_credits, files, input_token, out_token) => {
    try {
        await prisma.$transaction(async (tx) => {
            
            // 1. Kreditek levonása ATOMIKUSAN (Nincs versenyhelyzet!)
            // Itt a te eredeti, tökéletes SQL logikádat használjuk a Prisma tranzakción belül
            await tx.$executeRaw`
                UPDATE subscriptions 
                SET remaining_credits = GREATEST(0, remaining_credits - ${used_credits}) 
                WHERE user_id = ${user_id}
            `;

            // 2. Session megkeresése vagy létrehozása (UPSERT)
            const placeholder = prompt ? prompt.substring(0, 100) : "";
            const currentSession = await tx.session.upsert({
                where: { session_crypted: session_crypted },
                update: {}, 
                create: {
                    user_id: user_id,
                    session_crypted: session_crypted,
                    session_placeholder: placeholder,
                    slice_index: 0 
                }
            });

            // 3. Promt mentése
            const newPrompt = await tx.promts.create({
                data: {
                    session_id: currentSession.id,
                    promt: prompt,
                    answare: message,
                    input_token: input_token,
                    out_token: out_token
                }
            });

            // 4. Fájlok mentése egyszerre
            if (files && files.length > 0) {
                const fileRecords = files.map(fileKey => ({
                    promt_id: newPrompt.id,
                    file_key: fileKey
                }));

                await tx.prompt_files.createMany({
                    data: fileRecords
                });
            }

            // 5. Slice index növelése ATOMIKUSAN
            await tx.session.update({
                where: { id: currentSession.id },
                data: {
                    slice_index: { increment: 1 } // A Prisma increment-je is védett a versenyhelyzet ellen!
                }
            });

        });

    } catch (err) {
        console.error('Hiba az addMessage futása közben:', err);
        throw err;
    }
};


/**
 * @typedef {import('@prisma/client').promts} PrismaPromts
 * @typedef {PrismaPromts & { files: { file_key: string }[] }} MessageWithFiles
 */

/**
 * Lekéri az üzeneteket és a hozzájuk tartozó fájlokat.
 * @param {number} id - A session ID-ja
 * @returns {Promise<MessageWithFiles[]>}
 */
export const getMessages = async ( id ) => {

    const result = await prisma.session.findUnique( { where: { id: id}, select: { slice_index: true} } );

    if(!result){

        return [];

    }

    const { slice_index } = result;

    let prompts;

    if( slice_index > 0 ){

        prompts = await prisma.promts.findMany( { where: {session_id: id}, orderBy: { id: 'desc' }, take: slice_index } )

        prompts.reverse();
    }
    else{

        prompts = await prisma.promts.findMany( { where: {session_id: id}, orderBy: { id: 'asc' }, } )

    }

    if(prompts.length === 0){

        return [];

    }
    const prompt_ids = prompts.map(msg => msg.id);

    const files = await prisma.prompt_files.findMany( { where: { promt_id: { in: prompt_ids } }, select: { promt_id: true, file_key: true} } )
    
    const filesByMessageId = {};

    for (const file of files) {

        if (!filesByMessageId[file.promt_id]) {

            filesByMessageId[file.promt_id] = [];

        }

        filesByMessageId[file.promt_id].push(file.file_key);

    }


    for (const msg of prompts) {

        msg.files = filesByMessageId[msg.id] || []; 

    }

    return prompts;
};

/**
 * @typedef {import('@prisma/client').promts} PrismaPromts
 * @typedef {PrismaPromts & { files: { file_key: string }[] }} MessageWithFiles
 */

/**
 * Lekéri az üzeneteket és a hozzájuk tartozó fájlokat.
 * @param {number} id - A session ID-ja
 * @returns {Promise<MessageWithFiles[]>}
 */
export const getMessagesByOffset = async (session_crypted, limit) => {

    const takeAmount = 5;
    const parsedLimit = Number.parseInt(limit) || takeAmount;
    const offset = Math.max(0, parsedLimit - takeAmount); 
    

    const result = await prisma.session.findUnique( { where: { session_crypted: session_crypted }, select: { id: true } } )

    if(!result){

        return [];

    }

    const id = result.id;

    const prompts = await prisma.promts.findMany( { where: { session_id: id }, orderBy: { id: 'desc' }, take: takeAmount, skip: offset } );

    if(prompts.length === 0 ){

        return [];

    }
    const prompt_ids = prompts.map(msg => msg.id);

    const files = await prisma.prompt_files.findMany( { where: { promt_id: { in: prompt_ids } }, select: { promt_id: true, file_key: true} } )
    
    const filesByMessageId = {};

    for (const file of files) {

        if (!filesByMessageId[file.promt_id]) {

            filesByMessageId[file.promt_id] = [];

        }

        filesByMessageId[file.promt_id].push(file.file_key);

    }


    for (const msg of prompts) {

        msg.files = filesByMessageId[msg.id] || []; 

    }

    return prompts.reverse();
};


export default {addMessage, getMessages, getMessagesByOffset }