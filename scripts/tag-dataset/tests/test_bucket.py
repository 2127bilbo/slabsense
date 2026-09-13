import pytest
from botocore.exceptions import ClientError

from tagdataset import bucket as bucket_mod


class StubPaginator:
    def __init__(self, pages):
        self.pages = pages
        self.paginate_calls = []

    def paginate(self, **kwargs):
        self.paginate_calls.append(kwargs)
        return self.pages


class StubClient:
    def __init__(self):
        self.calls = []
        self.put_objects = []
        self.head_responses = []  # list of exceptions (or None for success), popped per call
        self.paginator = None
        self.client_args = None
        self.client_kwargs = None

    def put_object(self, **kwargs):
        self.calls.append(("put_object", kwargs))
        self.put_objects.append(kwargs)

    def head_object(self, **kwargs):
        self.calls.append(("head_object", kwargs))
        outcome = self.head_responses.pop(0)
        if outcome is not None:
            raise outcome
        return {}

    def get_paginator(self, name):
        self.calls.append(("get_paginator", name))
        return self.paginator


@pytest.fixture
def stub_client(monkeypatch):
    client = StubClient()

    def fake_client(*args, **kwargs):
        client.client_args = args
        client.client_kwargs = kwargs
        return client

    monkeypatch.setattr(bucket_mod.boto3, "client", fake_client)
    return client


def make_bucket(prefix="tag-dataset", key_id="kid", app_key="akey"):
    return bucket_mod.Bucket(
        "https://s3.us-west-002.backblazeb2.com", "us-west-002", "bucketname", key_id, app_key, prefix
    )


# ── constructor ──────────────────────────────────────────────────────────

def test_constructor_raises_without_key_id(stub_client):
    with pytest.raises(RuntimeError, match="B2_KEY_ID"):
        make_bucket(key_id=None, app_key="x")


def test_constructor_raises_without_app_key(stub_client):
    with pytest.raises(RuntimeError, match="B2_KEY_ID"):
        make_bucket(key_id="x", app_key="")


def test_constructor_builds_s3_client_with_credentials(stub_client):
    make_bucket(key_id="kid", app_key="akey")
    assert stub_client.client_args == ("s3",)
    assert stub_client.client_kwargs["endpoint_url"] == "https://s3.us-west-002.backblazeb2.com"
    assert stub_client.client_kwargs["region_name"] == "us-west-002"
    assert stub_client.client_kwargs["aws_access_key_id"] == "kid"
    assert stub_client.client_kwargs["aws_secret_access_key"] == "akey"


# ── key() ────────────────────────────────────────────────────────────────

def test_key_layout(stub_client):
    b = make_bucket(prefix="tag-dataset")
    assert b.key("C1", "front.jpg") == "tag-dataset/C1/front.jpg"


def test_key_strips_surrounding_slashes_from_prefix(stub_client):
    b = make_bucket(prefix="/tag-dataset/")
    assert b.key("C1", "front.jpg") == "tag-dataset/C1/front.jpg"


# ── put() ────────────────────────────────────────────────────────────────

def test_put_calls_put_object_with_expected_args(stub_client):
    b = make_bucket()
    b.put("C1", "front.jpg", b"abc", "image/jpeg")
    assert stub_client.put_objects[-1] == {
        "Bucket": "bucketname",
        "Key": "tag-dataset/C1/front.jpg",
        "Body": b"abc",
        "ContentType": "image/jpeg",
    }


# ── exists() ─────────────────────────────────────────────────────────────

def test_exists_true_when_head_object_succeeds(stub_client):
    b = make_bucket()
    stub_client.head_responses = [None]
    assert b.exists("C1", "front.jpg") is True


@pytest.mark.parametrize("code", ["404", "NoSuchKey", "NotFound"])
def test_exists_false_for_not_found_codes(stub_client, code):
    b = make_bucket()
    stub_client.head_responses = [ClientError({"Error": {"Code": code, "Message": "x"}}, "HeadObject")]
    assert b.exists("C1", "front.jpg") is False


def test_exists_reraises_other_client_errors(stub_client):
    b = make_bucket()
    stub_client.head_responses = [ClientError({"Error": {"Code": "403", "Message": "x"}}, "HeadObject")]
    with pytest.raises(ClientError):
        b.exists("C1", "front.jpg")


# ── list_keys() ──────────────────────────────────────────────────────────

def test_list_keys_paginates_and_strips_prefix(stub_client):
    b = make_bucket()
    pages = [
        {"Contents": [{"Key": "tag-dataset/C1/front.jpg"}, {"Key": "tag-dataset/C1/corner_FTL.png"}]},
        {"Contents": [{"Key": "tag-dataset/C2/back.jpg"}, {"Key": "tag-dataset/"}]},
        {},
    ]
    paginator = StubPaginator(pages)
    stub_client.paginator = paginator

    result = b.list_keys()

    assert result == {("C1", "front.jpg"), ("C1", "corner_FTL.png"), ("C2", "back.jpg")}
    assert ("get_paginator", "list_objects_v2") in stub_client.calls
    assert paginator.paginate_calls == [{"Bucket": "bucketname", "Prefix": "tag-dataset/"}]
