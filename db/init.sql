-- Initial storage only. HTTP operations will be designed in part 2.
CREATE TABLE links (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code TEXT NOT NULL UNIQUE CHECK (char_length(code) > 0),
    original_url TEXT NOT NULL CHECK (char_length(original_url) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clicks BIGINT NOT NULL DEFAULT 0 CHECK (clicks >= 0)
);
