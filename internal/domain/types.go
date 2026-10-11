// Package domain holds the resource shapes from contracts/api.md and the ticket writes
// shared by the email pipeline and the helpdesk API. Every query is workspace-scoped.
package domain

import (
	"time"

	"github.com/google/uuid"
)

type UserRef struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	AvatarURL string    `json:"avatar_url"`
}

type ContactRef struct {
	ID        uuid.UUID `json:"id"`
	Email     *string   `json:"email"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatar_url"`
}

type CompanyRef struct {
	ID     uuid.UUID `json:"id"`
	Name   string    `json:"name"`
	Domain string    `json:"domain"`
}

type Contact struct {
	ID          uuid.UUID      `json:"id"`
	Email       *string        `json:"email"`
	Name        string         `json:"name"`
	Phone       string         `json:"phone"`
	AvatarURL   string         `json:"avatar_url"`
	Company     *CompanyRef    `json:"company"`
	ExternalID  *string        `json:"external_id"`
	Notes       string         `json:"notes"`
	Custom      map[string]any `json:"custom"`
	Blocked     bool           `json:"blocked"`
	TicketCount int            `json:"ticket_count"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type Tag struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

type TicketSLA struct {
	PolicyID           uuid.UUID  `json:"policy_id"`
	FirstResponseDueAt *time.Time `json:"first_response_due_at"`
	ResolutionDueAt    *time.Time `json:"resolution_due_at"`
	Breached           bool       `json:"breached"`
}

type CSAT struct {
	Score   int    `json:"score"`
	Comment string `json:"comment"`
}

// Ticket statuses, priorities and channels.
const (
	StatusOpen    = "open"
	StatusPending = "pending"
	StatusOnHold  = "on_hold"
	StatusSolved  = "solved"
	StatusClosed  = "closed"

	ChannelEmail  = "email"
	ChannelChat   = "chat"
	ChannelAPI    = "api"
	ChannelPortal = "portal"
)

var (
	Statuses   = []string{StatusOpen, StatusPending, StatusOnHold, StatusSolved, StatusClosed}
	Priorities = []string{"low", "normal", "high", "urgent"}
	Channels   = []string{ChannelEmail, ChannelChat, ChannelAPI, ChannelPortal}
)

type Ticket struct {
	ID                    uuid.UUID      `json:"id"`
	Number                int64          `json:"number"`
	Subject               string         `json:"subject"`
	Status                string         `json:"status" enum:"open,pending,on_hold,solved,closed"`
	Priority              string         `json:"priority" enum:"low,normal,high,urgent"`
	Channel               string         `json:"channel" enum:"email,chat,api,portal"`
	MailboxID             *uuid.UUID     `json:"mailbox_id"`
	Contact               *ContactRef    `json:"contact"`
	Assignee              *UserRef       `json:"assignee"`
	TeamID                *uuid.UUID     `json:"team_id"`
	Tags                  []Tag          `json:"tags"`
	SLA                   *TicketSLA     `json:"sla"`
	FirstRespondedAt      *time.Time     `json:"first_responded_at"`
	SolvedAt              *time.Time     `json:"solved_at"`
	SnoozedUntil          *time.Time     `json:"snoozed_until"`
	LastMessageAt         time.Time      `json:"last_message_at"`
	LastCustomerMessageAt *time.Time     `json:"last_customer_message_at"`
	LastMessagePreview    string         `json:"last_message_preview"`
	MessageCount          int            `json:"message_count"`
	Spam                  bool           `json:"spam"`
	CSAT                  *CSAT          `json:"csat"`
	Custom                map[string]any `json:"custom"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
}

type Attachment struct {
	ID          uuid.UUID `json:"id"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	SizeBytes   int64     `json:"size_bytes"`
	Inline      bool      `json:"inline"`
	URL         string    `json:"url"`
}

type MessageAuthor struct {
	Type    string      `json:"type" enum:"contact,user,system,api"`
	User    *UserRef    `json:"user"`
	Contact *ContactRef `json:"contact"`
}

type Message struct {
	ID             uuid.UUID     `json:"id"`
	TicketID       uuid.UUID     `json:"ticket_id"`
	Kind           string        `json:"kind" enum:"reply,note"`
	Direction      string        `json:"direction" enum:"inbound,outbound"`
	Author         MessageAuthor `json:"author"`
	BodyHTML       string        `json:"body_html"`
	BodyText       string        `json:"body_text"`
	HasQuoted      bool          `json:"has_quoted"`
	Subject        string        `json:"subject"`
	FromEmail      string        `json:"from_email"`
	FromName       string        `json:"from_name"`
	To             []string      `json:"to"`
	Cc             []string      `json:"cc"`
	Bcc            []string      `json:"bcc"`
	Attachments    []Attachment  `json:"attachments"`
	DeliveryStatus string        `json:"delivery_status" enum:"none,pending,sent,failed,bounced"`
	DeliveryError  string        `json:"delivery_error"`
	CreatedAt      time.Time     `json:"created_at"`
}

type ActivityActor struct {
	Type string   `json:"type"`
	User *UserRef `json:"user"`
}

type Activity struct {
	ID        uuid.UUID      `json:"id"`
	TicketID  uuid.UUID      `json:"ticket_id"`
	Actor     ActivityActor  `json:"actor"`
	Type      string         `json:"type"`
	Data      map[string]any `json:"data"`
	CreatedAt time.Time      `json:"created_at"`
}
