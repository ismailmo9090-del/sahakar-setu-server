import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function convertToPCM16(inputPath: string, outputPath: string): Promise<void> {
  await execAsync(
    `ffmpeg -i "${inputPath}" -f s16le -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}"`
  );
}

export async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  await execAsync(
    `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -f wav "${outputPath}"`
  );
}
