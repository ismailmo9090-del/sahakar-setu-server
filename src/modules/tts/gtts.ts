import { spawn, ChildProcess } from 'child_process';
import readline from 'readline';
import { randomUUID } from 'crypto';
import { logger } from '../../config/logger.js';

let instance: GttsTTS | null = null;

export function getGttsTTS(): GttsTTS {
  if (!instance || !instance.isAlive()) {
    instance = new GttsTTS();
  }
  return instance;
}

export class GttsTTS {
  private process: ChildProcess;
  private rl: readline.Interface;
  private pending = new Map<string, { resolve: (audio: Buffer) => void; reject: (err: Error) => void }>();
  private alive = true;

  constructor() {
    this.process = spawn('python', ['scripts/gtts_service.py'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.rl = readline.createInterface({ input: this.process.stdout! });

    this.rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'audio') {
          const entry = this.pending.get(msg.id);
          if (entry) {
            entry.resolve(Buffer.from(msg.data, 'base64'));
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
        logger.debug({ err: e }, 'gTTS parse error');
      }
    });

    this.process.stderr?.on('data', (data) => {
      logger.debug({ data: data.toString().trim() }, 'gTTS stderr');
    });

    this.process.on('exit', (code) => {
      logger.warn({ code }, 'gTTS service exited');
      this.alive = false;
      for (const [id, entry] of this.pending) {
        entry.reject(new Error('gTTS process exited'));
      }
      this.pending.clear();
    });

    this.process.on('error', (err) => {
      logger.warn({ err: err.message }, 'gTTS process error');
      this.alive = false;
    });
  }

  isAlive(): boolean {
    return this.alive && this.process.exitCode === null;
  }

  synthesize(text: string, lang: string = 'hi'): Promise<Buffer> {
    if (!this.isAlive()) {
      return Promise.reject(new Error('gTTS service not available'));
    }

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('gTTS timeout after 30s'));
      }, 30000);

      this.pending.set(id, {
        resolve: (audio: Buffer) => {
          clearTimeout(timeout);
          resolve(audio);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.process.stdin!.write(JSON.stringify({ text, lang, id }) + '\n');
    });
  }
}
