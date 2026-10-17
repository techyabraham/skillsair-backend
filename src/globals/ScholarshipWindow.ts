import type { GlobalConfig } from 'payload'

export const ScholarshipWindow: GlobalConfig = {
  slug: 'scholarship-window',
  label: 'Scholarship Window',
  admin: {
    group: 'Sales',
    description:
      "When this window closes, every programme is charged its standard fee until a new window opens. Close windows when announced. Between windows, the standard fee is charged. Don't extend a window after its closing date has been announced to learners.",
  },
  access: {
    // The window dates are public facts shown on the site; nothing here is sensitive.
    read: () => true,
    update: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'isOpen', type: 'checkbox', defaultValue: false, label: 'Scholarship window is open' },
        { name: 'laptopsPerCohort', type: 'number', defaultValue: 2, min: 0 },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'opensAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
        {
          name: 'closesAt',
          type: 'date',
          admin: { date: { pickerAppearance: 'dayAndTime' }, description: 'Required while the window is open.' },
          validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) => {
            if (siblingData?.isOpen && !value) return 'A closing date is required while the window is open'
            return true
          },
        },
      ],
    },
    {
      name: 'cohortLabel',
      type: 'text',
      admin: { description: 'Everyone who enrols between the cohort dates belongs to this cohort, whatever they paid.' },
    },
    {
      type: 'row',
      fields: [
        { name: 'cohortStartsAt', type: 'date' },
        { name: 'cohortEndsAt', type: 'date' },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'laptopApplicationsOpen', type: 'checkbox', defaultValue: false, label: 'Laptop applications are open', admin: { description: 'Shown in the certificate email (T9).' } },
        {
          name: 'laptopApplicationDeadline',
          type: 'date',
          admin: { date: { pickerAppearance: 'dayAndTime' }, description: 'Real deadline for this cohort’s laptop applications. Within 10 days, certificate email C2 is replaced by its deadline version.' },
        },
      ],
    },
  ],
}
