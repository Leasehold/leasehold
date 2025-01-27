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

const { config: DefaultConfig } = require('./defaults');
const Chain = require('./chain');
const { migrations } = require('./migrations');
const {
	TransferTransaction,
	SecondSignatureTransaction,
	DelegateTransaction,
	VoteTransaction,
	MultisignatureTransaction
} = require('@liskhq/lisk-transactions');
const {
	DappTransaction,
	InTransferTransaction,
	OutTransferTransaction
} = require('./extra_transactions');

const BaseModule = require('leasehold-lisk-framework/src/modules/base_module');
const DEFAULT_MODULE_ALIAS = 'leasehold_chain';
const pkg = require('./package.json');

/* eslint-disable class-methods-use-this */

/**
 * Leasehold module specification
 *
 * @namespace Framework.Modules
 * @type {module.LeaseholdChainModule}
 */
module.exports = class LeaseholdChainModule extends BaseModule {
	constructor(options) {
		super({...DefaultConfig.default, ...options});
		if (!options) {
			options = {};
		}

		this.alias = options.alias || DEFAULT_MODULE_ALIAS;
		this.logger = options.logger;

		this.chain = null;
	}

	static get dependencies() {
		return ['app', 'network'];
	}

	static get alias() {
		return DEFAULT_MODULE_ALIAS;
	}

	static get info() {
		return {
			author: 'Jonathan Gros-Dubois',
			version: pkg.version,
			name: DEFAULT_MODULE_ALIAS,
		};
	}

	static get migrations() {
		return [];
	}

	static get defaults() {
		return DefaultConfig;
	}

	get events() {
		return [
			'bootstrap',
			'blocks:change',
			'transactions:confirmed:change',
			'signature:change',
			'transactions:change',
			'rounds:change',
			'multisignatures:signature:change',
			'multisignatures:change',
			'delegates:fork',
			'loader:sync',
			'dapps:change',
		];
	}

	get actions() {
		return {
			calculateSupply: {
				handler: action => this.chain.actions.calculateSupply(action),
			},
			calculateMilestone: {
				handler: action => this.chain.actions.calculateMilestone(action),
			},
			calculateReward: {
				handler: action => this.chain.actions.calculateReward(action),
			},
			generateDelegateList: {
				handler: action => this.chain.actions.generateDelegateList(action),
			},
			updateForgingStatus: {
				handler: async action => this.chain.actions.updateForgingStatus(action),
			},
			getForgingStatusForAllDelegates: {
				handler: async () =>
					this.chain.actions.getForgingStatusForAllDelegates(),
			},
			getTransactionsFromPool: {
				handler: async action =>
					this.chain.actions.getTransactionsFromPool(action),
			},
			getTransactions: {
				handler: async () => this.chain.actions.getTransactions(),
				isPublic: true,
			},
			postTransaction: {
				handler: async action => this.chain.actions.postTransaction(action),
			},
			getDelegateBlocksRewards: {
				handler: async action =>
					this.chain.actions.getDelegateBlocksRewards(action),
			},
			getSlotNumber: {
				handler: async action => this.chain.actions.getSlotNumber(action),
			},
			calcSlotRound: {
				handler: async action => this.chain.actions.calcSlotRound(action),
			},
			getNodeStatus: {
				handler: async () => this.chain.actions.getNodeStatus(),
			},
			getLastBlock: {
				handler: async () => this.chain.actions.getLastBlock(),
			},
			blocks: {
				handler: async action => this.chain.actions.blocks(action),
				isPublic: true,
			},
			blocksCommon: {
				handler: async action => this.chain.actions.blocksCommon(action),
				isPublic: true,
			},
			getMultisigWalletMembers: {
				handler: async action => this.chain.actions.getMultisigWalletMembers(action),
			},
			getMinMultisigRequiredSignatures: {
				handler: async action => this.chain.actions.getMinMultisigRequiredSignatures(action),
			},
			getInboundTransactions: {
				handler: async action => this.chain.actions.getInboundTransactions(action),
			},
			getOutboundTransactions: {
				handler: async action => this.chain.actions.getOutboundTransactions(action),
			},
			getInboundTransactionsFromBlock: {
				handler: async action => this.chain.actions.getInboundTransactionsFromBlock(action),
			},
			getOutboundTransactionsFromBlock: {
				handler: async action => this.chain.actions.getOutboundTransactionsFromBlock(action),
			},
			getLastBlockAtTimestamp: {
				handler: async action => this.chain.actions.getLastBlockAtTimestamp(action),
			},
			getMaxBlockHeight: {
				handler: async action => this.chain.actions.getMaxBlockHeight(action),
			},
			getBlocksBetweenHeights: {
				handler: async action => this.chain.actions.getBlocksBetweenHeights(action),
			},
			getBlockAtHeight: {
				handler: async action => this.chain.actions.getBlockAtHeight(action),
			},
			getModuleOptions: {
				handler: async action => this.chain.actions.getModuleOptions(action),
			}
		};
	}

	async load(channel, options) {
		this.options = options;
		this.options.registeredTransactions = {
			'0': Object.freeze(TransferTransaction),
			'1': Object.freeze(SecondSignatureTransaction),
			'2': Object.freeze(DelegateTransaction),
			'3': Object.freeze(VoteTransaction),
			'4': Object.freeze(MultisignatureTransaction),
			'5': Object.freeze(DappTransaction),
			'6': Object.freeze(InTransferTransaction),
			'7': Object.freeze(OutTransferTransaction)
		};
		this.chain = new Chain(channel, this.options, this.alias, this.logger, {
			[this.alias]: migrations
		});
		await this.chain.bootstrap();
		channel.publish(`${this.alias}:bootstrap`);
	}

	async unload() {
		return this.chain.cleanup();
	}
};
