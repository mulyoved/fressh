import { type KeyboardSlot } from '../../../src/lib/shell-config';

type WorkNavigationSlot = Extract<KeyboardSlot, { type: 'action' }>;

export function createWorkNavigationSlot(): WorkNavigationSlot {
	return {
		type: 'action',
		actionId: 'WORKMUX_NAV_NEXT',
		label: 'Work',
		icon: 'AppWindow',
		span: 2,
		longPress: {
			options: [
				{
					type: 'action',
					actionId: 'WORKMUX_NAV_PREV',
					label: 'Prev',
					icon: null,
				},
				{
					type: 'action',
					actionId: 'WORKMUX_NAV_NEXT',
					label: 'Next',
					icon: null,
				},
				{
					type: 'action',
					actionId: 'WORKMUX_NAV_SCOPE_ACTIVE',
					label: 'Active',
					icon: null,
				},
				{
					type: 'action',
					actionId: 'WORKMUX_NAV_SCOPE_VISIBLE',
					label: '+Busy',
					icon: null,
				},
				{
					type: 'action',
					actionId: 'WORKMUX_NAV_SCOPE_ALL',
					label: 'All',
					icon: null,
				},
			],
		},
	};
}
