/*
 * Copyright © 2019 Lisk Foundation
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Unless otherwise agreed in a custom licensing agreement with the Lisk Foundation,
 * no part of this software, including this file, may be copied, modified,
 * propagated, or distributed except according to the terms contained in the
 * LICENSE file.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

'use strict';

const { TransactionError } = require('@liskhq/lisk-transactions');
const { validator } = require('@liskhq/lisk-validator');
const _ = require('lodash');
const { convertErrorsToString } = require('../utils/error_handlers');
const Broadcaster = require('./broadcaster');
const definitions = require('../schema/definitions');
const blocksUtils = require('../blocks');
const transactionsModule = require('../transactions');

/**
 * Main transport methods. Initializes library with scope content and generates a Broadcaster instance.
 *
 * @class
 * @memberof modules
 * @see Parent: {@link modules}
 * @requires async
 * @requires api/ws/rpc/failure_codes
 * @requires api/ws/rpc/failure_codes
 * @requires api/ws/workers/rules
 * @requires api/ws/rpc/ws_rpc
 * @requires logic/broadcaster
 * @param {scope} scope - App instance
 */
class Transport {
	constructor({
		moduleAlias,
		// components
		channel,
		logger,
		storage,
		// Unique requirements
		applicationState,
		exceptions,
		// Modules
		transactionPoolModule,
		blocksModule,
		loaderModule,
		interfaceAdapters,
		// Constants
		nonce,
		broadcasts,
		maxSharedTransactions,
	}) {
		this.message = {};

		this.moduleAlias = moduleAlias;
		this.channel = channel;
		this.logger = logger;
		this.storage = storage;
		this.applicationState = applicationState;
		this.exceptions = exceptions;

		this.constants = {
			nonce,
			broadcasts,
			maxSharedTransactions,
		};

		this.transactionPoolModule = transactionPoolModule;
		this.blocksModule = blocksModule;
		this.loaderModule = loaderModule;
		this.interfaceAdapters = interfaceAdapters;

		this.broadcaster = new Broadcaster(
			this.constants.nonce,
			this.constants.broadcasts,
			this.transactionPoolModule,
			this.logger,
			this.channel,
			this.storage,
			this.moduleAlias
		);
	}

	/**
	 * Calls enqueue transactions and emits a 'transactions/change' socket message.
	 *
	 * @param {transaction} transaction
	 * @param {Object} broadcast
	 * @emits transactions/change
	 * @todo Add description for the params
	 */
	// eslint-disable-next-line class-methods-use-this
	onUnconfirmedTransaction(transaction, broadcast) {
		if (broadcast) {
			const transactionJSON = transaction.toJSON();
			this.broadcaster.enqueue(
				{},
				{
					api: `${this.moduleAlias}:postTransactions`,
					data: {
						transaction: transactionJSON,
					},
				},
			);
			this.channel.publish(`${this.moduleAlias}:transactions:change`, transactionJSON);
		}
	}

	/**
	 * Calls broadcast blocks and emits a 'blocks/change' socket message.
	 *
	 * @param {Object} block - Reduced block object
	 * @param {boolean} broadcast - Signal flag for broadcast
	 * @emits blocks/change
	 */
	// TODO: Remove after block module becomes event-emitter
	// eslint-disable-next-line class-methods-use-this
	onBroadcastBlock(block, broadcast) {
		// Exit immediately when 'broadcast' flag is not set
		if (!broadcast) return null;

		if (this.loaderModule.syncing()) {
			this.logger.debug(
				'Transport->onBroadcastBlock: Aborted - blockchain synchronization in progress',
			);
			return null;
		}

		if (block.totalAmount) {
			block.totalAmount = block.totalAmount.toString();
		}

		if (block.totalFee) {
			block.totalFee = block.totalFee.toString();
		}

		if (block.reward) {
			block.reward = block.reward.toString();
		}

		if (block.transactions) {
			// Convert transactions to JSON
			block.transactions = block.transactions.map(transactionInstance =>
				transactionInstance.toJSON(),
			);
		}

		const { broadhash } = this.applicationState;

		// Perform actual broadcast operation
		return this.broadcaster.broadcast(
			{
				broadhash,
			},
			{ api: `${this.moduleAlias}:postBlock`, data: { block } },
		);
	}

	/**
	 * @property {function} blocksCommon
	 * @property {function} blocks
	 * @property {function} postBlock
	 * @property {function} list
	 * @property {function} height
	 * @property {function} status
	 * @property {function} getSignatures
	 * @property {function} getTransactions
	 * @property {function} postTransactions
	 * @todo Add description for the functions
	 * @todo Implement API comments with apidoc.
	 * @see {@link http://apidocjs.com/}
	 */
	/**
	 * Description of blocksCommon.
	 *
	 * @todo Add @param tags
	 * @todo Add @returns tag
	 * @todo Add description of the function
	 */
	async blocksCommon(query) {
		query = query || {};

		if (query.ids && query.ids.split(',').length > 1000) {
			throw new Error('ids property contains more than 1000 values');
		}

		const errors = validator.validate(definitions.WSBlocksCommonRequest, query);

		if (errors.length) {
			const error = `${errors[0].message}: ${errors[0].path}`;
			this.logger.debug('Common block request validation failed', {
				err: error.toString(),
				req: query,
			});
			throw new Error(error);
		}

		const escapedIds = query.ids
			// Remove quotes
			.replace(/['"]+/g, '')
			// Separate by comma into an array
			.split(',')
			// Reject any non-numeric values
			.filter(id => /^[0-9]+$/.test(id));

		if (!escapedIds.length) {
			this.logger.debug('Common block request validation failed', {
				err: 'ESCAPE',
				req: query.ids,
			});

			throw new Error('Invalid block id sequence');
		}

		try {
			const row = await this.storage.entities.Block.get({
				id: escapedIds[0],
			});

			if (!row.length > 0) {
				return {
					success: true,
					common: null,
				};
			}

			const { height, id, previousBlockId: previousBlock, timestamp } = row[0];

			const parsedRow = {
				id,
				height,
				previousBlock,
				timestamp,
			};

			return {
				success: true,
				common: parsedRow,
			};
		} catch (error) {
			this.logger.error(error.stack);
			throw new Error('Failed to get common block');
		}
	}

	/**
	 * Description of blocks.
	 *
	 * @todo Add @param tags
	 * @todo Add description of the function
	 */
	// eslint-disable-next-line consistent-return
	async blocks(query) {
		// Get 34 blocks with all data (joins) from provided block id
		// According to maxium payload of 58150 bytes per block with every transaction being a vote
		// Discounting maxium compression setting used in middleware
		// Maximum transport payload = 2000000 bytes
		if (!query || !query.lastBlockId) {
			return {
				success: false,
				message: 'Invalid lastBlockId requested',
			};
		}

		try {
			const data = await this.blocksModule.loadBlocksDataWS({
				limit: 34, // 1977100 bytes
				lastId: query.lastBlockId,
			});

			_.each(data, block => {
				if (block.tf_data) {
					try {
						block.tf_data = block.tf_data.toString('utf8');
					} catch (e) {
						this.logger.error(
							'Transport->blocks: Failed to convert data field to UTF-8',
							{
								block,
								error: e,
							},
						);
					}
				}
			});

			return { blocks: data, success: true };
		} catch (err) {
			return {
				blocks: [],
				message: err,
				success: false,
			};
		}
	}

	/**
	 * Description of postBlock.
	 *
	 * @todo Add @param tags
	 * @todo Add @returns tag
	 * @todo Add description of the function
	 */
	async postBlock(query = {}) {
		if (!this.constants.broadcasts.active) {
			return this.logger.debug(
				'Receiving blocks disabled by user through config.json',
			);
		}

		const errors = validator.validate(definitions.WSBlocksBroadcast, query);

		if (errors.length) {
			this.logger.debug(
				'Received post block broadcast request in unexpected format',
				{
					errors,
					module: 'transport',
					query,
				},
			);
			// TODO: If there is an error, invoke the applyPenalty action on the Network module once it is implemented.
			throw errors;
		}

		let block = blocksUtils.addBlockProperties(query.block);

		// Instantiate transaction classes
		block.transactions = this.interfaceAdapters.transactions.fromBlock(block);

		block = blocksUtils.objectNormalize(block);
		// TODO: endpoint should be protected before
		if (this.loaderModule.syncing()) {
			return this.logger.debug(
				"Client is syncing. Can't receive block at the moment.",
				block.id,
			);
		}
		return this.blocksModule.receiveBlockFromNetwork(block);
	}

	/**
	 * Description of getTransactions.
	 *
	 * @todo Add @param tags
	 * @todo Add @returns tag
	 * @todo Add description of the function
	 */
	async getTransactions() {
		const transactions = this.transactionPoolModule.getMergedTransactionList(
			true,
			this.constants.maxSharedTransactions,
		);

		return {
			success: true,
			transactions,
		};
	}

	/**
	 * Description of postTransaction.
	 *
	 * @todo Add @param tags
	 * @todo Add @returns tag
	 * @todo Add description of the function
	 */
	async postTransaction(query) {
		try {
			let { transaction } = query;
			let sanitizedTransaction = {
				...transaction
			};
			if (transaction.signatures) {
				sanitizedTransaction.signatures = transaction.signatures.map(
					signaturePacket => typeof signaturePacket === 'string' ? signaturePacket : signaturePacket && signaturePacket.signature
				);
			}
			const id = await this._receiveTransaction(sanitizedTransaction);
			return {
				success: true,
				transactionId: id,
			};
		} catch (errors) {
			let err = new Error(convertErrorsToString(errors));
			err.name = 'InvalidTransactionError';
			err.type = 'InvalidActionError';
			throw err;
		}
	}

	/**
	 * Description of postTransactions.
	 *
	 * @todo Add @param tags
	 * @todo Add @returns tag
	 * @todo Add description of the function
	 */
	async postTransactions(query) {
		if (!this.constants.broadcasts.active) {
			return this.logger.debug(
				'Receiving transactions disabled by user through config.json',
			);
		}

		const errors = validator.validate(definitions.WSTransactionsRequest, query);

		if (errors.length) {
			this.logger.debug('Invalid transactions body', errors);
			// TODO: If there is an error, invoke the applyPenalty action on the Network module once it is implemented.
			throw errors;
		}

		return this._receiveTransactions(query.transactions);
	}

	/**
	 * Validates transactions with schema and calls receiveTransaction for each transaction.
	 *
	 * @private
	 * @implements {__private.receiveTransaction}
	 * @param {Array} transactions - Array of transactions
	 */
	async _receiveTransactions(transactions = []) {
		// eslint-disable-next-line no-restricted-syntax
		for (const transaction of transactions) {
			try {
				if (transaction) {
					transaction.bundled = true;
				}
				// eslint-disable-next-line no-await-in-loop
				await this._receiveTransaction(transaction);
			} catch (err) {
				this.logger.debug(convertErrorsToString(err), transaction);
			}
		}
	}

	/**
	 * Normalizes transaction
	 * processUnconfirmedTransaction to confirm it.
	 *
	 * @private
	 * @param {transaction} transaction
	 * @returns {Promise.<boolean, Error>}
	 * @todo Add description for the params
	 */
	async _receiveTransaction(transactionJSON) {
		const id = transactionJSON ? transactionJSON.id : 'null';
		let transaction;
		try {
			transaction = this.interfaceAdapters.transactions.fromJson(
				transactionJSON,
			);

			const composedTransactionsCheck = transactionsModule.composeTransactionSteps(
				transactionsModule.checkAllowedTransactions(
					this.blocksModule.lastBlock,
				),
				transactionsModule.validateTransactions(this.exceptions),
			);

			const { transactionsResponses } = await composedTransactionsCheck([
				transaction,
			]);

			if (transactionsResponses[0].errors.length > 0) {
				throw transactionsResponses[0].errors;
			}
		} catch (errors) {
			const errString = convertErrorsToString(errors);
			this.logger.debug('Transaction normalization failed', {
				id,
				err: errString,
				module: 'transport',
			});

			// TODO: If there is an error, invoke the applyPenalty action on the Network module once it is implemented.
			throw errors;
		}

		this.logger.debug(`Received transaction ${transaction.id}`);

		try {
			await this.transactionPoolModule.processUnconfirmedTransaction(
				transaction,
				true,
			);
			return transaction.id;
		} catch (err) {
			this.logger.debug(`Transaction ${id}`, convertErrorsToString(err));
			if (transaction) {
				this.logger.debug('Transaction', transaction);
			}
			throw err;
		}
	}
}

// Export
module.exports = { Transport };
