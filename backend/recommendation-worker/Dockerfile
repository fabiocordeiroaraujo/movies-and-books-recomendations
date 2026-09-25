FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /worker

COPY requirements.txt ./
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      torch==2.7.1+cpu \
    && pip install --no-cache-dir -r requirements.txt

ENV USE_TF=0

COPY recommendation_worker ./recommendation_worker
COPY tests ./tests

RUN useradd --create-home --uid 10001 worker \
    && mkdir -p /models /artifacts \
    && chown -R worker:worker /worker /models /artifacts

USER worker

CMD ["python", "-m", "recommendation_worker", "daily"]
