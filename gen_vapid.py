# gen_vapid.py
import base64
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

b64u = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()

priv = ec.generate_private_key(ec.SECP256R1())
priv_bytes = priv.private_numbers().private_value.to_bytes(32, 'big')
pub_bytes = priv.public_key().public_bytes(
    serialization.Encoding.X962,
    serialization.PublicFormat.UncompressedPoint
)

print("VAPID_PUBLIC =", b64u(pub_bytes))
print("VAPID_PRIVATE=", b64u(priv_bytes))
