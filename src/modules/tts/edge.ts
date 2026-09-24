import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import readline from 'readline';
import { randomUUID } from 'crypto';
import { logger } from '../../config/logger.js';
import { cacheGet, cacheSet, isRedisAvailable } from '../../services/cache.js';
import { createHash } from 'crypto';

const ttsMemoryCache = new Map<string, Buffer>();
const MEMORY_CACHE_MAX = 200;

export class EdgeTTS extends EventEmitter {
  private process: ChildProcess;
  private rl: readline.Interface;
  private pending = new Map<string, { resolve: (audio: Buffer) => void; reject: (err: Error) => void }>();
  private alive = true;

  constructor() {
    super();
    this.process = spawn('python', ['scripts/tts_service.py'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.rl = readline.createInterface({ input: this.process.stdout! });

    this.rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'audio') {
          const entry = this.pending.get(msg.id);
          if (entry) {
            const audio = Buffer.from(msg.data, 'base64');
            entry.resolve(audio);
            this.pending.delete(msg.id);
          }
        } else if (msg.type === 'error') {
          const entry = this.pending.get(msg.id);
          if (entry) {
            entry.reject(new Error(msg.message));
            this.pending.delete(msg.id);
          }
        }
      } catch (e) {
        logger.debug({ err: e }, 'TTS parse error');
      }
    });

    this.process.stderr?.on('data', (data) => {
      logger.debug({ data: data.toString().trim() }, 'TTS stderr');
    });

    this.process.on('exit', (code) => {
      logger.warn({ code }, 'TTS service exited');
      this.alive = false;
      for (const [id, entry] of this.pending) {
        entry.reject(new Error('TTS process exited'));
      }
      this.pending.clear();
    });

    this.process.on('error', (err) => {
      logger.warn({ err: err.message }, 'TTS process error');
      this.alive = false;
    });
  }

  isAlive(): boolean {
    return this.alive && this.process.exitCode === null;
  }

  async synthesize(text: string, lang: string = 'hi'): Promise<Buffer> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      throw new Error('Cannot synthesize empty text');
    }

    const cacheKey = `tts:${lang}:${createHash('sha256').update(normalizedText).digest('hex')}`;

    const memCached = ttsMemoryCache.get(cacheKey);
    if (memCached) {
      return memCached;
    }

    if (isRedisAvailable()) {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        if (ttsMemoryCache.size >= MEMORY_CACHE_MAX) {
          const firstKey = ttsMemoryCache.keys().next().value;
          if (firstKey) ttsMemoryCache.delete(firstKey);
        }
        ttsMemoryCache.set(cacheKey, cached);
        return cached;
      }
    }

    if (!this.isAlive()) {
      throw new Error('TTS service not available');
    }

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('TTS timeout after 30s'));
      }, 30000);

      this.pending.set(id, {
        resolve: (audio: Buffer) => {
          clearTimeout(timeout);
          cacheSet(cacheKey, audio, 86400).catch(() => {});
          if (ttsMemoryCache.size >= MEMORY_CACHE_MAX) {
            const firstKey = ttsMemoryCache.keys().next().value;
            if (firstKey) ttsMemoryCache.delete(firstKey);
          }
          ttsMemoryCache.set(cacheKey, audio);
          resolve(audio);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.process.stdin!.write(JSON.stringify({ text: normalizedText, lang, id }) + '\n');
    });
  }

  close() {
    this.alive = false;
    this.process.kill();
    this.rl.close();
  }
}
