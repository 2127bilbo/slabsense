"""Read-only R2 access. Reader.get returns bytes; Reader.size returns Content-Length."""
from __future__ import annotations

import boto3
from botocore.config import Config as BotoConfig


class Reader:
    def __init__(self, endpoint: str, region: str, bucket: str, key_id: str | None, app_key: str | None):
        if not key_id or not app_key:
            raise RuntimeError("Set B2_KEY_ID and B2_APP_KEY in the environment")
        self.bucket = bucket
        self.client = boto3.client(
            "s3", endpoint_url=endpoint, region_name=region,
            aws_access_key_id=key_id, aws_secret_access_key=app_key,
            config=BotoConfig(retries={"max_attempts": 5, "mode": "standard"}, max_pool_connections=32),
        )

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def size(self, key: str) -> int:
        return int(self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"])


def reader_from_config(cfg) -> Reader:
    return Reader(cfg.r2_endpoint, cfg.r2_region, cfg.r2_bucket, cfg.r2_key_id, cfg.r2_app_key)
