package kb

import "github.com/google/uuid"

// NewKBID mints the id the studio URL carries. The `kb-` prefix keeps ids
// recognisable in logs and in the Temporal UI, where the workflow is `ingest-kb-…`,
// and the e2e specs match on `/studio/kb-`.
//
// Eight hex characters is 4 billion values, which is plenty for a POC and short enough
// to read out loud when debugging.
func NewKBID() string {
	return "kb-" + uuid.NewString()[:8]
}
