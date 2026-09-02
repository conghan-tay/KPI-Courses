// Package store persists knowledge bases.
//
// The service layer depends on Repository rather than on pgx, so its tests need no
// database and swapping Postgres for something else is one implementation.
package store

import (
	"context"
	"errors"

	"github.com/example/reverse-interview/services/gateway/internal/api"
)

var (
	// ErrNotFound means no row exists for the id or slug.
	ErrNotFound = errors.New("knowledge base not found")
	// ErrUnknownUser means the caller identified itself as somebody who is not seeded.
	ErrUnknownUser = errors.New("unknown user")
)

// Repository is the gateway's view of persistence.
type Repository interface {
	// List returns one candidate's knowledge bases, newest first.
	List(ctx context.Context, candidateID string) ([]api.KnowledgeBase, error)
	Get(ctx context.Context, id string) (api.KnowledgeBase, error)
	GetBySlug(ctx context.Context, slug string) (api.KnowledgeBase, error)
	// Create writes a new knowledge base, resolving a slug collision by suffixing.
	Create(ctx context.Context, knowledgeBase api.KnowledgeBase) (api.KnowledgeBase, error)
	// Update applies mutate to the stored row inside a transaction that holds a row
	// lock, so two concurrent PATCHes cannot clobber each other. mutate must be pure:
	// it may be called against a row that was read moments ago and it must not assume
	// anything it did not receive.
	Update(
		ctx context.Context, id string, mutate func(api.KnowledgeBase) api.KnowledgeBase,
	) (api.KnowledgeBase, error)
	// ListRunning returns the ids of knowledge bases whose ingestion has not finished.
	// The gateway re-attaches a completion watcher to each of these at boot, so a
	// restart mid-ingestion does not strand a draft in "running" forever.
	ListRunning(ctx context.Context) ([]string, error)
	// User resolves a seeded identity. Returns ErrUnknownUser rather than a zero value,
	// so a bad X-Candidate-Id can never be mistaken for a valid one.
	User(ctx context.Context, id string) (api.User, error)
}
