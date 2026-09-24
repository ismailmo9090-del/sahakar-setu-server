FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python-is-python3 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY requirements-runtime.txt ./
RUN pip3 install --break-system-packages --no-cache-dir -r requirements-runtime.txt

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
