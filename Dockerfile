FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y build-essential && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD gunicorn -w 2 -k gthread -t 120 -b 0.0.0.0:$PORT app:app
gunicorn app:app --workers 1 --threads 4 --bind 0.0.0.0:8000
