package auth

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Argon2id parameters. Passwords are hashed with nothing else.
const (
	argonMemory  = 64 * 1024
	argonTime    = 3
	argonThreads = 2
	argonKeyLen  = 32
	argonSaltLen = 16
)

// Password length rules (OWASP ASVS 2.1.1 and 2.1.2).
const (
	PasswordMinLength = 12
	PasswordMaxLength = 128
)

var (
	ErrPasswordTooShort = errors.New("password must be at least 12 characters")
	ErrPasswordTooLong  = errors.New("password must be 128 characters or less")
	ErrPasswordBreached = errors.New("this password has appeared in a data breach; choose a different one")
)

// breachedList is the NCSC top-100k breached passwords. See passwords/README.md.
//
//go:embed passwords/breached.txt
var breachedList []byte

var (
	breachedOnce sync.Once
	breachedSet  map[string]struct{}
)

// CheckPassword is the single gate on every new or changed password: registration,
// reset, change and invitation acceptance all call it.
func CheckPassword(pw string) error {
	n := utf8.RuneCountInString(pw)
	switch {
	case n < PasswordMinLength:
		return ErrPasswordTooShort
	case n > PasswordMaxLength:
		return ErrPasswordTooLong
	}
	breachedOnce.Do(func() {
		breachedSet = make(map[string]struct{}, 48000)
		sc := bufio.NewScanner(bytes.NewReader(breachedList))
		for sc.Scan() {
			if line := strings.TrimSpace(sc.Text()); line != "" {
				breachedSet[strings.ToLower(line)] = struct{}{}
			}
		}
	})
	if _, ok := breachedSet[strings.ToLower(pw)]; ok {
		return ErrPasswordBreached
	}
	return nil
}

// HashPassword returns a PHC-format Argon2id hash.
func HashPassword(pw string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(pw), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword compares pw against a PHC Argon2id hash in constant time.
func VerifyPassword(pw, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var m, t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(pw), salt, t, m, p, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// DummyVerify burns the same time as a real check, so unknown emails do not answer faster.
func DummyVerify(pw string) {
	VerifyPassword(pw, "$argon2id$v=19$m=65536,t=3,p=2$c29tZXNhbHRzb21lc2FsdA$4Z8hYxqYmN2pJ0m7c8b2nH0Xz2bA9cS1kQe3lQ1tY0M")
}
