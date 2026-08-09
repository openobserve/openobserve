FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && pip freeze > /app/pins.txt
COPY app.py .
CMD ["python", "app.py"]
