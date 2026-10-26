import verify from '../Midleware/verify.js';
import express from 'express';
import AiDataBase from './AiDataBase.js';
import rateLimiter from '../Midleware/rateLimiter.js';
import logger from '../winstonown.js';
import crypto from 'node:crypto';
import { checkSubStatus } from '../Subscription/subData.js';
import { downloadFromR2, getUploadUrl, downloadJson, transformFile, uploadJson, prepareFileForClaude } from './filefunctions.js';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import { prisma } from '../database.js';
import { z } from 'zod' 
import validator from '../Midleware/validator.js';
const router = express.Router();
const anthropic = new AnthropicBedrock({
  awsRegion: process.env.AWS_REGION || 'us-east-1',
});
const activeUserStreams = new Set();

async function load_cache(user_id, id, previous) {

    const starter_cap = 50000;

    const slice_cap = 100000;

    let sum = 0;

    let data = [];

    let slice_index = 0;

    let flag = false;

    for(let i = previous.length - 1; i >= 0; i--){

      let cache_cost = previous[i].out_token;

      sum += cache_cost;

      data.push(previous[i])
      
      if(sum >= starter_cap && flag === false){

        slice_index = previous.length - (i + 1)

        flag = true;

      }
      if(sum >= slice_cap){

        await prisma.session.update( { where: { user_id: user_id, id: id},data: { slice_index: slice_index} } );

        return data.reverse()
        

      }

    }

    return previous;

}

const chatLimiter = rateLimiter.createRateLimiter({

  windowSeconds: 1 * 60,
  maxAttempts: 30,

});

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const uploadSchema = z.object({
    files: z.array(
        z.object({
            fileName: z.string({ message: 'File name must be a string' })
                .min(1, { message: 'File name cannot be empty' }),
                
            fileType: z.string({ message: 'File type must be a string' })
                .min(1, { message: 'File type cannot be empty' }),

            fileSize: z.number()
                .int({ message: 'File size must be an integer' })
                .max(MAX_FILE_SIZE, { message: 'File size exceeds the maximum limit of 5 MB' })
        })     
      )
    .max(5, { message: 'Maximum 5 files are allowed' })
    .min(1, { message: 'At least one file is required' }) 
});


const uploadValidator = validator.createValidator({

    Schema: uploadSchema

});


const strictJsonLimitFile = express.json({ limit: '1mb' });

router.post('/api/getUploadUrl', strictJsonLimitFile, verify.verifyToken, chatLimiter, uploadValidator, async (req, res) => {

  const userId = req.user?.userId;
  const files = req.body?.files; // [ {fileName, fileType, fileSize}, {fileName, fileType, fileSize}]
  const ip = req.ip;
  const requestId = req.id;

  logger.info('/api/getUploadUrl', { userId: userId, ip: ip,  productionOnly: true, requestId: requestId, file: files} );

  try{

    let promises = files.map( async (file) => {

      const result =  await getUploadUrl(file, userId)

      if(!result.uniqueFileKey || !result.uploadUrl){

        logger.error('/api/getUploadUrl', { succes: 'File size exceeds the maximum limit of 5 MB', userId: userId, ip: ip, requestId: requestId } );

        throw new Error('UPLOAD_URL_FAILED');

      }

      return result;

    });

    const results = await Promise.all(promises);

    logger.info('/api/getUploadUrl', { succes: 'The download links are available', userId: userId, ip: ip, results: results, productionOnly: true, requestId: requestId } );

    logger.info('/api/getUploadUrl', { succes: 'The download links are available', userId: userId, ip: ip, requestId: requestId  } );

    return res.status(200).json( results );

  }catch(err){

    logger.error('/api/getUploadUrl', {
      error: {
          message: err.message,
          stack: err.stack,
          code: err.code
      },
      userId: userId,
      ip: ip,
      requestId: req.id
    });

    if(err.message === 'UPLOAD_URL_FAILED'){

      return res.status(400).json({ error: 'File size exceeds the maximum limit of 5 MB' });

    }

    return res.status(500).json({ error: 'Unexpexted error' });

  }

})

const models = { Sonnet: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0', Opus: 'eu.anthropic.claude-opus-4-5-20251101-v1:0', Haiku: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0' }

const MODEL_PRICING = {
  Sonnet: { 
    input: 2.00, 
    output: 10.00, 
    cacheWrite5m: 2.50,
    cacheWrite1h: 4.00,
    cacheRead: 0.10 
  },
  Haiku:  { 
    input: 0.10, 
    output: 0.50, 
    cacheWrite5m: 0.125, 
    cacheWrite1h: 0.20, 
    cacheRead: 0.01 
  },
  Opus:   { 
    input: 4.00, 
    output: 20.00, 
    cacheWrite5m: 5.00, 
    cacheWrite1h: 8.00, 
    cacheRead: 0.20 
  },
};
const credit_value = 0.001

const askSchema = z.object({
    prompt: z.string({ message: 'Prompt must be a string' })
        .max(50000, { message: 'Prompt cannot exceed 50,000 characters' }) 
        .optional()
        .nullable(),
        
    sessionId: z.string({ message: 'SessionId must be a string' })
        .max(255, { message: 'SessionId is too long' }) 
        .optional()
        .nullable(),
        
    keys: z.array(z.string({ message: 'Each key must be a string' }), { message: 'Keys must be an array' })
        .max(5, { message: 'Maximum 5 keys are allowed' })
        .optional()
        .nullable(),
        
    model: z.string({ message: 'Model must be a string' })
        .max(100, { message: 'Model cannot exceed 100 characters' })
        .min(1, { message: 'Model cannot be empty' }),
        
    instruct: z.string({ message: 'Instruct must be a string' })
        .max(5000, { message: 'Instruct cannot exceed 5000 characters' })
        .optional()
        .nullable()
}).refine((data) => {

    const isKeysEmpty = !data.keys || data.keys.length === 0;
    const isPromptEmpty = !data.prompt || data.prompt.trim() === '';
    
    return !(isKeysEmpty && isPromptEmpty);
}, {
    message: 'You must provide either a prompt or keys.',
    path: ['prompt']
});

const askValidator = validator.createValidator({

    Schema: askSchema

});

const safeText = (t) => {
  const s = String(t ?? '').trim();
  return s.length ? s : '(empty)'; 
};

const strictJsonLimit = express.json({ limit: '2mb' });

router.post('/api/ask',  strictJsonLimit, verify.verifyToken, chatLimiter, askValidator, async (req, res) => {

    const userId = req.user?.userId;
    const ip = req.ip;
    const requestId = req.id;
    
    if (activeUserStreams.has(userId)) {

      logger.warn('/api/ask', { message: 'Concurrent stream blocked', userId, ip });

      return res.status(429).json({ error: 'Please wait for the previous request to complete.' });

    }

    // * ============================================================================
    // * Acces check (does the user have privilage to use ).
    // * ============================================================================
    try{

      const valid = await checkSubStatus(userId);

      if(!valid){

        logger.error('/api/ask', { succes: 'No valid subscription or not enough credit.', userId: userId, ip: ip, requestId: requestId } );

        return res.status(403).json({ error: 'No valid subscription or not enough credit.' });

      }

      activeUserStreams.add(userId);

    }catch(err){

      logger.error('/api/ask', {
        error: {
            message: err.message,
            stack: err.stack,
            code: err.code
        },
        userId: userId,
        ip: ip,
        requestId: req.id
      });

      return res.status(500).json({ error: 'Unexpexted error' });
      
    }

    let actual_promt = req.body?.prompt;
    let sessionId = req.body?.sessionId; 
    const keys = req.body?.keys || [];
    const model = req.body?.model
    const instruct = req.body?.instruct

    try{

       if(!sessionId){

        sessionId = crypto.randomUUID();

        logger.info('/api/ask', { message: 'Generated sessionid', sessionId: sessionId, userId: userId, ip: ip } );

      }
      else{

        const result = await prisma.session.findUnique( {where : { session_crypted: sessionId, user_id: userId }, select: { session_crypted: true }} );

        logger.info('/api/ask', { actual_promt: actual_promt, session_crypted: sessionId, isvalidSessionId: result, keys: keys, model: model, instruct: instruct } );

        if(!result){

          sessionId = crypto.randomUUID();

          logger.info('/api/ask', { message: 'Generated sessionid', sessionId: sessionId, userId: userId, ip: ip } );

        }
      }

      if (!Object.hasOwn(models, model)) {

        logger.error('/api/ask', { error: { message: 'Bad request there is no model like this (!Object.hasOwn(models, model))', userId: userId, ip: ip } } );

        return res.status(400).json({ error: 'Bad request there is no model like this' });

      }

      const modelcode = models[model];

      logger.info('/api/ask', { modelcode: modelcode, userId: userId, ip: ip} );

      actual_promt = safeText(actual_promt);

      if (actual_promt === '(empty)') {

        actual_promt = (keys && keys.length > 0) ? 'analyze this file' : '(empty)';

      }


      // * ============================================================================
      // * Prepare files
      // * ============================================================================

       const prepared_files_promises = keys.map(async (key) => {

        if (!key.startsWith(`${userId}/`)) {

          return res.status(403).json({  error: 'error: Access denied: This file does not belong to your account!' });
        
        }

        const downloaded_file = await downloadFromR2(key);

        const file = await transformFile(downloaded_file);

        const prepared_file =  await prepareFileForClaude(file, key);

        const baseName = key.substring(0, key.lastIndexOf('.')) || key;

        const jsonKey = `${baseName}-claude.json`;

        await uploadJson(jsonKey, prepared_file);

        return prepared_file

      })

      const prepared_files = await Promise.all(prepared_files_promises); //  [ { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0... ]

      logger.info('/api/ask', { message: 'Prepared files', prepared_files_length : prepared_files.length } );
      
      // * ============================================================================
      // * load previous content if existed.
      // * ============================================================================

      const result = await prisma.session.findUnique( { where: { session_crypted: sessionId, user_id: userId }, select: { id: true } } );

      let messages = [];

      if(result){

        const { id } = result;

        const previous = await AiDataBase.getMessages(id) // return { id, promt, answare, input_token, out_token, files: [ 'file_key', 'ile_key; ]  }

        const prevoius_messages = await load_cache(userId, id, previous);

        // * ============================================================================
        // * Process previous content.
        // * ====================================================s========================

        const messages_prepare = prevoius_messages.map(async (prev_messages, index) => {

          let processing_messages = []

          const promt = safeText(prev_messages.promt);
          const answare = safeText(prev_messages.answare);

          const files_array = prev_messages.files;

          if(files_array.length !== 0){
            
            const processFiles = files_array.map(async (file_key) =>{

              const baseName = file_key.substring(0, file_key.lastIndexOf('.')) || file_key;

              const jsonKey = `${baseName}-claude.json`;
              
              return await downloadJson(jsonKey);
              
            })

            const downloadedJsons = await Promise.all(processFiles);
      
            const currentContent = [
                ...downloadedJsons,
                { type: 'text', text: promt || 'Elemezd a fájlt!' }
            ];

            processing_messages.push({ role: 'user', content: currentContent });

          }else{

            processing_messages.push({ role: 'user', content: promt })

          }

          processing_messages.push({ role: 'assistant', content: [{type: 'text', text: String(answare)}] })

          return processing_messages;

        })

        const nestedMessages = await Promise.all(messages_prepare);

        messages = nestedMessages.flat();
        
      }

      //logger.info('/api/ask', { messages: messages, userId: userId, ip: ip, productionOnly: true} );

      // * ============================================================================
      // * Process final content.
      // * ============================================================================

      let currentContent = [];

      if(prepared_files.length !== 0){

        for(const file of prepared_files){

          currentContent.push(file)

        }

        currentContent.push({ type: 'text', text: actual_promt || 'analyze this file', cache_control: { type: 'ephemeral' } })

        messages.push({ role: 'user', content: currentContent });

      }
      else{

        messages.push({ role: 'user', content: [
            {
                type: 'text',
                text: actual_promt,
                cache_control: { type: 'ephemeral' }
            }
          ] 
        })

      }

      // * ============================================================================
      // * Start content stream.
      // * ============================================================================

      const maxOutputTokens = modelcode.includes('sonnet') ? 8192 : 4096;

      const stream = anthropic.messages.stream({

        model: modelcode,
        max_tokens: maxOutputTokens,
        system: [
          {
            type: 'text',
            text: instruct || 'You are a helpful assistant.',
            cache_control: { type: 'ephemeral' } 
          }
        ],
        messages: messages

      });

      //res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform'); // no-transform kikapcsolja a tömörítő middleware-eket
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Nginx pufferelés kikapcsolása
      
      // Custom header engedélyezése a frontend számára
      res.setHeader('Access-Control-Expose-Headers', 'X-Session-ID');
      res.setHeader('X-Session-ID', sessionId);

      // 2. Fejlécek azonnali elküldése (flush) a kliensnek
      res.flushHeaders();

      let finalUsage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
      let accumulatedAnswer = '';
      let isAborted = false;

      // 2. Kliens megszakításának figyelése
      const onClose = () => {
          isAborted = true;
          logger.info('/api/ask', { message: 'Client closed connection, aborting stream', sessionId, userId });
          stream.abort(); // Leállítja az Anthropic API hívást
      };

      res.on('close', onClose);

      stream.on('text', (textDelta) => {
          accumulatedAnswer += textDelta;
          // Biztonsági ellenőrzés: csak akkor írunk, ha még nyitva a stream
          if (!res.writableEnded) {
              res.write(textDelta);
          }
      });

      stream.on('message', (message) => {

        logger.info('/api/ask', { message: 'Stream.on message', userId: userId, requestId: requestId, ip: ip, usage: message.usage, productionOnly: true  });

      })
     
      stream.on('streamEvent', (event) => {

          if (event.type === 'message_start' && event.message.usage) {
              finalUsage.input_tokens = event.message.usage.input_tokens || finalUsage.input_tokens;
              finalUsage.cache_creation_input_tokens =event.message.usage.cache_creation_input_tokens;
              finalUsage.cache_read_input_tokens = event.message.usage.cache_read_input_tokens;
          }

          if (event.type === 'message_delta' && event.usage) {
              finalUsage.output_tokens = event.usage.output_tokens || finalUsage.output_tokens;
          }

      });

      try {
          // 3. Várjuk meg a stream végét
          await stream.done();
          logger.info('/api/ask', { message: 'stream finished', sessionId, userId });
      } catch (err) {
          // Az abort() egy AbortError-t dob, ezt el kell nyelnünk
          if (err.name === 'AbortError' || err.message?.includes('abort')) {
              logger.info('/api/ask', { message: 'Anthropic stream properly aborted', sessionId });
          } else {
              // Minden más hibát továbbdobunk a külső try-catch-nek
              throw err;
          }
      } finally {
        // 4. Takarítás és Mentés (Ez MINDIG lefut, megszakítás esetén is!)
        req.off('close', onClose);

        // HA megszakadt, és nem kaptuk meg a végső kimeneti tokenszámot, megbecsüljük (~4 karakter = 1 token angol/magyar szövegnél)
        if (isAborted && finalUsage.output_tokens === 0) {
            finalUsage.output_tokens = Math.ceil(accumulatedAnswer.length / 4);
            logger.info('/api/ask', { message: 'Estimated output tokens due to abort', estimatedTokens: finalUsage.output_tokens });
        }

        const pricing = MODEL_PRICING[model];
        const normalInputCost = (finalUsage.input_tokens / 1000000) * pricing.input;

        const cacheCreation5mCost = ((finalUsage.cache_creation?.ephemeral_5m_input_tokens || 0) / 1000000) * pricing.cacheWrite5m;
        const cacheCreation1hCost = ((finalUsage.cache_creation?.ephemeral_1h_input_tokens || 0) / 1000000) * pricing.cacheWrite1h;

        const cacheReadCost = ((finalUsage.cache_read_input_tokens || 0) / 1000000) * pricing.cacheRead;
        const outputCost = (finalUsage.output_tokens / 1000000) * pricing.output;

        const totalPriceUSD = normalInputCost + cacheCreation5mCost + cacheCreation1hCost + cacheReadCost + outputCost;
        const used_credits = Math.ceil(totalPriceUSD / credit_value);

        logger.info('/api/ask', { message: 'Anthropic stream ended, saving', userId: userId, ip: ip, requestId: requestId, used_credits: used_credits, totalPriceUSD: totalPriceUSD });

        try{

          await AiDataBase.addMessage(
            userId, actual_promt, accumulatedAnswer, sessionId, used_credits, 
            keys, finalUsage.input_tokens, finalUsage.output_tokens
          );

        }catch(err){

          console.log(err)

        }

        if (!res.writableEnded) {
            res.end();
        }
      }

    } catch (err) {

      console.log(err)

      if (!res.headersSent) {

        res.status(500).json({ error: 'Unexpected error' });

      } else {

        res.end();

      }
    }finally{

      activeUserStreams.delete(userId);

    }
});


export default router;

   