import { type ControllerOutcome } from './controller-core';

type OutcomeWithFailure = ControllerOutcome<unknown>;

type OutcomeFailure<TOutcome extends OutcomeWithFailure> =
	Extract<TOutcome, { status: 'failed' }> extends { failure: infer TFailure }
		? TFailure
		: never;

type OutcomeHandlers<TOutcome extends OutcomeWithFailure> = {
	completed(outcome: Extract<TOutcome, { status: 'completed' }>): unknown;
	failed(outcome: Extract<TOutcome, { status: 'failed' }>): unknown;
	superseded(outcome: Extract<TOutcome, { status: 'superseded' }>): unknown;
	unavailable(outcome: Extract<TOutcome, { status: 'unavailable' }>): unknown;
};

type HandlerResult<THandlers extends OutcomeHandlers<OutcomeWithFailure>> =
	ReturnType<
		| THandlers['completed']
		| THandlers['failed']
		| THandlers['superseded']
		| THandlers['unavailable']
	>;

export function matchControllerOutcome<
	TOutcome extends OutcomeWithFailure,
	THandlers extends OutcomeHandlers<TOutcome>,
>(outcome: TOutcome, handlers: THandlers): HandlerResult<THandlers> {
	switch (outcome.status) {
		case 'completed':
			return handlers.completed(
				outcome as Extract<TOutcome, { status: 'completed' }>,
			) as HandlerResult<THandlers>;
		case 'failed':
			return handlers.failed(
				outcome as Extract<TOutcome, { status: 'failed' }>,
			) as HandlerResult<THandlers>;
		case 'superseded':
			return handlers.superseded(
				outcome as Extract<TOutcome, { status: 'superseded' }>,
			) as HandlerResult<THandlers>;
		case 'unavailable':
			return handlers.unavailable(
				outcome as Extract<TOutcome, { status: 'unavailable' }>,
			) as HandlerResult<THandlers>;
	}
}

export function unwrapControllerOutput<
	TOutcome extends OutcomeWithFailure & { output?: string },
>(
	outcome: TOutcome,
	messages: {
		superseded: string;
		unavailable: string;
		failureToError?: (failure: OutcomeFailure<TOutcome>) => Error;
	},
): string {
	return matchControllerOutcome(outcome, {
		completed: (completed) => completed.output ?? '',
		failed: (failed) => {
			const failure = failed.failure as OutcomeFailure<TOutcome>;
			if (messages.failureToError) {
				throw messages.failureToError(failure);
			}
			throw new Error((failure as { message: string }).message);
		},
		superseded: () => {
			throw new Error(messages.superseded);
		},
		unavailable: () => {
			throw new Error(messages.unavailable);
		},
	});
}
