package courses

import "github.com/google/uuid"

// NewCourseID mints the id the studio URL carries. The `course-` prefix keeps ids
// recognisable in logs and in the Temporal UI, where the workflow is `ingest-course-…`,
// and the e2e specs match on `/studio/course-`.
//
// Eight hex characters is 4 billion values, which is plenty for a POC and short enough
// to read out loud when debugging.
func NewCourseID() string {
	return "course-" + uuid.NewString()[:8]
}
