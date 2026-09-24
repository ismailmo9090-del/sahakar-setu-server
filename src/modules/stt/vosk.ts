import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import readline from 'readline';
import { randomUUID } from 'crypto';
import { logger } from '../../config/logger.js';

export class VoskSTT extends EventEmitter {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private ready = false;
  private alive = false;
  private pendingWav = new Map<string, { resolve: (text: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();

  constructor() {
    super();
    try {
      this.process = spawn('python', ['scripts/vosk_worker.py'], {
        env: { ...process.env, VOSK_MODEL_PATH: process.env.VOSK_MODEL_PATH || 'models' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.alive = true;

      this.rl = readline.createInterface({ input: this.process.stdout! });

      this.rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'ready') {
            this.ready = true;
            this.emit('ready');
          }
          if (msg.type === 'error') {
            logger.warn({ message: msg.message }, 'Vosk worker error');
            const entry = msg.id ? this.pendingWav.get(msg.id) : undefined;
            if (entry) {
              this.pendingWav.delete(msg.id);
              entry.reject(new Error(msg.message));
            }
            this.emit('error_msg', msg);
          }
          if (msg.type === 'transcript') {
            this.emit(msg.is_final ? 'final' : 'partial', msg);
            if (msg.is_final && msg.id) {
              const entry = this.pendingWav.get(msg.id);
              if (entry) {
                this.pendingWav.delete(msg.id);
                clearTimeout(entry.timer);
                entry.resolve(msg.text || '');
              }
            }
          }
          if (msg.type === 'reset_done') {
            this.emit('reset_done');
          }
        } catch (e) {
          // ignore parse errors
        }
      });

      this.process.stderr?.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('WARNING') && !msg.includes('DEBUG')) {
          logger.debug({ msg }, 'Vosk stderr');
        }
      });

      this.process.on('exit', (code) => {
        logger.warn({ code }, 'Vosk worker exited');
        this.ready = false;
        this.alive = false;
        for (const [id, entry] of this.pendingWav) {
          clearTimeout(entry.timer);
          entry.reject(new Error('Vosk worker exited'));
        }
        this.pendingWav.clear();
      });

      this.process.on('error', (err) => {
        logger.warn({ err: err.message }, 'Vosk worker spawn error');
        this.ready = false;
        this.alive = false;
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to start Vosk worker');
      this.ready = false;
      this.alive = false;
    }
  }

  sendAudio(pcmBase64: string) {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(JSON.stringify({ type: 'audio', data: pcmBase64 }) + '\n');
  }

  transcribeWav(wavPath: string, lang: string = 'hi', timeoutMs: number = 20000): Promise<string> {
    const send = () => {
      if (!this.isAlive() || !this.process?.stdin?.writable) {
        return Promise.reject(new Error('Vosk worker not available'));
      }
      return new Promise<string>((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => {
          this.pendingWav.delete(id);
          reject(new Error('Vosk transcription timeout'));
        }, timeoutMs);
        this.pendingWav.set(id, { resolve, reject, timer });
        this.process!.stdin!.write(JSON.stringify({ type: 'wav_file', path: wavPath, lang, id }) + '\n');
      });
    };

    if (this.ready) return send();
    return new Promise<string>((resolve, reject) => {
      const waitTimer = setTimeout(() => {
        this.removeListener('ready', onReady);
        reject(new Error('Vosk worker not ready in time'));
      }, 15000);
      const onReady = () => {
        clearTimeout(waitTimer);
        send().then(resolve).catch(reject);
      };
      this.once('ready', onReady);
    });
  }

  reset() {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(JSON.stringify({ type: 'reset' }) + '\n');
  }

  isReady(): boolean {
    return this.ready;
  }

  isAlive(): boolean {
    return this.alive && this.process?.exitCode === null;
  }

  close() {
    this.alive = false;
    this.ready = false;
    this.process?.kill();
    this.rl?.close();
  }
}
