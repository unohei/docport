import uuid
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from r2_client import s3, BUCKET

app = FastAPI()

# 開発中はCORSを許可（本番は絞る）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def health():
    return {"status": "ok"}

@app.post("/presign-upload")
def presign_upload():
    key = f"documents/{uuid.uuid4()}.pdf"
    url = s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": BUCKET,
            "Key": key,
            "ContentType": "application/pdf",
        },
        ExpiresIn=60 * 5,
    )
    return {"upload_url": url, "file_key": key}

@app.get("/presign-download")
def presign_download(key: str):
    url = s3.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=60 * 5,
    )
    return {"download_url": url}