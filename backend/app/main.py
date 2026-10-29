from fastapi import FastAPI

app = FastAPI(title="Birdography")


@app.get("/health")
def health():
    return {"status": "ok"}
