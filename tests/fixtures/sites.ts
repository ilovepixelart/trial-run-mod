/**
 * The court's pane as a docked terminal pane draws it.
 */
export const PANE_SITE = {
  plugin: 'trial-run',
  component: 'Pane',
  requestId: 'trial-run-court',
  props: {
    title: 'Court',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/**
 * The band above the prompt while a turn runs.
 */
export const BAND_SITE = {
  plugin: 'trial-run',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

/**
 * The docket's pane, as `/court docket` opens it.
 */
export const DOCKET_SITE = {
  ...PANE_SITE,
  requestId: 'trial-run-docket',
  props: { ...PANE_SITE.props, title: 'Docket', bodyColumns: 80 },
} as const
