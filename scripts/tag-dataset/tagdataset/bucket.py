"""Backblaze B2 via the S3-compatible API (spec §2, §5.3)."""
from __future__ import annotations

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError


class Bucket:
    def __init__(self, endpoint: str, region: str, name: str, key_id: str, app_key: str, prefix: str):
        if not key_id or not app_key:
            raise RuntimeError("Set B2_KEY_ID and B2_APP_KEY in the environment")
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=key_id,
            aws_secret_access_key=app_key,
            config=BotoConfig(retries={"max_attempts": 3, "mode": "standard"}, max_pool_connections=32),
        )
        self.name = name
        self.prefix = prefix.strip("/")

    def key(self, cert: str, name: str) -> str:
        return f"{self.prefix}/{cert}/{name}"

    def put(self, cert: str, name: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.name, Key=self.key(cert, name), Body=data, ContentType=content_type)

    def exists(self, cert: str, name: str) -> bool:
        try:
            self.client.head_object(Bucket=self.name, Key=self.key(cert, name))
            return True
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def list_keys(self) -> set[tuple[str, str]]:
        """Every (cert, name) under the prefix. One paginated listing, cheap even at 650k objects."""
        out: set[tuple[str, str]] = set()
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.name, Prefix=self.prefix + "/"):
            for obj in page.get("Contents", []):
                rel = obj["Key"][len(self.prefix) + 1:]
                cert, _, name = rel.partition("/")
                if cert and name:
                    out.add((cert, name))
        return out
