// Package crypto holds secret handling: AES-GCM sealing, token generation and hashing.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
)

// Box seals small secrets (mailbox credentials, webhook secrets) with AES-256-GCM.
type Box struct{ aead cipher.AEAD }

func NewBox(key []byte) (*Box, error) {
	if len(key) != 32 {
		return nil, errors.New("crypto: key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// Seal returns nonce || ciphertext.
func (b *Box) Seal(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return b.aead.Seal(nonce, nonce, plaintext, nil), nil
}

func (b *Box) Open(sealed []byte) ([]byte, error) {
	n := b.aead.NonceSize()
	if len(sealed) < n {
		return nil, errors.New("crypto: ciphertext too short")
	}
	return b.aead.Open(nil, sealed[:n], sealed[n:], nil)
}

// SealJSON encrypts v as JSON.
func (b *Box) SealJSON(v any) ([]byte, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return b.Seal(raw)
}

// OpenJSON decrypts into v. A nil input leaves v untouched.
func (b *Box) OpenJSON(sealed []byte, v any) error {
	if len(sealed) == 0 {
		return nil
	}
	raw, err := b.Open(sealed)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

// RandomToken returns n random bytes, base64url without padding.
func RandomToken(n int) string {
	b := make([]byte, n)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// RandomString returns a lowercase alphanumeric string of length n.
func RandomString(n int) string {
	const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
	b := make([]byte, n)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

// HashToken is the stored form of an opaque credential.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// HMACHex returns hex(HMAC-SHA256(key, msg)).
func HMACHex(key []byte, msg string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(msg))
	return hex.EncodeToString(m.Sum(nil))
}

// EqualHex compares two hex strings in constant time.
func EqualHex(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
