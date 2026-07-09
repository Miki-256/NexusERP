-- HCM Wave 5: performance & learning — goals, reviews, skills, training.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'performance_goal_status') THEN
    CREATE TYPE performance_goal_status AS ENUM ('draft', 'active', 'completed', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_cycle_status') THEN
    CREATE TYPE review_cycle_status AS ENUM ('draft', 'active', 'closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'performance_review_status') THEN
    CREATE TYPE performance_review_status AS ENUM (
      'draft', 'self_review', 'manager_review', 'submitted', 'approved', 'rejected'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'skill_proficiency_level') THEN
    CREATE TYPE skill_proficiency_level AS ENUM ('beginner', 'intermediate', 'advanced', 'expert');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'training_record_status') THEN
    CREATE TYPE training_record_status AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Skills catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_skills_org ON skills(organization_id, is_active);

CREATE TABLE IF NOT EXISTS employee_skills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  proficiency skill_proficiency_level NOT NULL DEFAULT 'intermediate',
  years_experience NUMERIC(4,1),
  notes TEXT,
  assessed_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_skills_emp ON employee_skills(employee_id);

-- ---------------------------------------------------------------------------
-- Performance goals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status review_cycle_status NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_cycles_org ON review_cycles(organization_id, status);

DROP TRIGGER IF EXISTS review_cycles_updated_at ON review_cycles;
CREATE TRIGGER review_cycles_updated_at
  BEFORE UPDATE ON review_cycles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS performance_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cycle_id UUID REFERENCES review_cycles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  target_date DATE,
  weight NUMERIC(5,2) NOT NULL DEFAULT 1,
  progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  status performance_goal_status NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_performance_goals_emp ON performance_goals(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_performance_goals_cycle ON performance_goals(cycle_id);

DROP TRIGGER IF EXISTS performance_goals_updated_at ON performance_goals;
CREATE TRIGGER performance_goals_updated_at
  BEFORE UPDATE ON performance_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Performance reviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS performance_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cycle_id UUID NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reviewer_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  status performance_review_status NOT NULL DEFAULT 'draft',
  overall_rating NUMERIC(3,2) CHECK (overall_rating IS NULL OR (overall_rating >= 1 AND overall_rating <= 5)),
  self_comments TEXT,
  manager_comments TEXT,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_performance_reviews_cycle ON performance_reviews(cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_emp ON performance_reviews(employee_id);

DROP TRIGGER IF EXISTS performance_reviews_updated_at ON performance_reviews;
CREATE TRIGGER performance_reviews_updated_at
  BEFORE UPDATE ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS review_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_id UUID NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
  criteria_code TEXT NOT NULL,
  criteria_name TEXT NOT NULL,
  self_rating NUMERIC(3,2) CHECK (self_rating IS NULL OR (self_rating >= 1 AND self_rating <= 5)),
  manager_rating NUMERIC(3,2) CHECK (manager_rating IS NULL OR (manager_rating >= 1 AND manager_rating <= 5)),
  comments TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (review_id, criteria_code)
);

CREATE INDEX IF NOT EXISTS idx_review_ratings_review ON review_ratings(review_id);

-- ---------------------------------------------------------------------------
-- Training
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT,
  duration_hours NUMERIC(6,2),
  description TEXT,
  is_mandatory BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_training_courses_org ON training_courses(organization_id, is_active);

CREATE TABLE IF NOT EXISTS employee_training_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  status training_record_status NOT NULL DEFAULT 'planned',
  started_at DATE,
  completed_at DATE,
  score NUMERIC(5,2),
  certificate_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_training_emp ON employee_training_records(employee_id, status);

DROP TRIGGER IF EXISTS employee_training_records_updated_at ON employee_training_records;
CREATE TRIGGER employee_training_records_updated_at
  BEFORE UPDATE ON employee_training_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_training_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skills_select ON skills;
CREATE POLICY skills_select ON skills FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS skills_write ON skills;
CREATE POLICY skills_write ON skills FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS employee_skills_select ON employee_skills;
CREATE POLICY employee_skills_select ON employee_skills FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_view_employee(employee_id)
  );

DROP POLICY IF EXISTS employee_skills_write ON employee_skills;
CREATE POLICY employee_skills_write ON employee_skills FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS review_cycles_select ON review_cycles;
CREATE POLICY review_cycles_select ON review_cycles FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS review_cycles_write ON review_cycles;
CREATE POLICY review_cycles_write ON review_cycles FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS performance_goals_select ON performance_goals;
CREATE POLICY performance_goals_select ON performance_goals FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_view_employee(employee_id)
  );

DROP POLICY IF EXISTS performance_goals_write ON performance_goals;
CREATE POLICY performance_goals_write ON performance_goals FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS performance_reviews_select ON performance_reviews;
CREATE POLICY performance_reviews_select ON performance_reviews FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_view_employee(employee_id)
  );

DROP POLICY IF EXISTS performance_reviews_write ON performance_reviews;
CREATE POLICY performance_reviews_write ON performance_reviews FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS review_ratings_select ON review_ratings;
CREATE POLICY review_ratings_select ON review_ratings FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND review_id IN (
      SELECT pr.id FROM performance_reviews pr
      WHERE public.user_can_view_employee(pr.employee_id)
    )
  );

DROP POLICY IF EXISTS review_ratings_write ON review_ratings;
CREATE POLICY review_ratings_write ON review_ratings FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS training_courses_select ON training_courses;
CREATE POLICY training_courses_select ON training_courses FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_has_hr_app_access(organization_id)
  );

DROP POLICY IF EXISTS training_courses_write ON training_courses;
CREATE POLICY training_courses_write ON training_courses FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));

DROP POLICY IF EXISTS employee_training_select ON employee_training_records;
CREATE POLICY employee_training_select ON employee_training_records FOR SELECT
  USING (
    organization_id IN (SELECT public.user_organization_ids())
    AND public.user_can_view_employee(employee_id)
  );

DROP POLICY IF EXISTS employee_training_write ON employee_training_records;
CREATE POLICY employee_training_write ON employee_training_records FOR ALL
  USING (public.user_can_manage_hr(organization_id))
  WITH CHECK (public.user_can_manage_hr(organization_id));
