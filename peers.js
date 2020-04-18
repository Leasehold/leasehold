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

const MAX_PEERS = 100;

/**
 * Main peers methods. Initializes library with scope content.
 *
 * @class
 * @memberof modules
 * @see Parent: {@link chain}
 * @param {scope} scope - App instance
 */
class Peers {
	constructor({ moduleAlias, channel, forgingForce, minBroadhashConsensus }) {
		this.moduleAlias = moduleAlias;
		this.forgingForce = forgingForce;
		this.channel = channel;
		this.minBroadhashConsensus = minBroadhashConsensus;
		this.broadhashConsensusCalculationInterval = 5000;
	}

	/**
	 * Returns consensus calculated by calculateConsensus.
	 *
	 * @returns {number|undefined} Last calculated consensus or null if wasn't calculated yet
	 */
	async getLastConsensus(broadhash) {
		return this.calculateConsensus(broadhash);
	}

	/**
	 * Calculates consensus for as a ratio active to matched peers.
	 *
	 * @returns {Promise.<number, Error>} Consensus or undefined if forgingForce = true
	 */
	// eslint-disable-next-line class-methods-use-this
	async calculateConsensus() {
		const appState = await this.channel.invoke('app:getApplicationState');
		const moduleInfo = appState.modules[this.moduleAlias];
		if (!moduleInfo) {
			return 0;
		}
		const { broadhash } = moduleInfo;

		const connectedPeers = await this.channel.invoke(
			'network:getConnectedPeers',
			{},
		);

		const activePeers = connectedPeers.filter(
			peer => peer.modules && peer.modules[this.moduleAlias]
		);

		const activeCount = Math.min(activePeers.length, MAX_PEERS);

		if (!activeCount) {
			return 0;
		}

		const matchingPeers = activePeers.filter(
			peer => peer.modules[this.moduleAlias].broadhash === broadhash
		);

		const matchedCount = Math.min(matchingPeers.length, MAX_PEERS);

		return Math.round(matchedCount * 10000 / activeCount) / 100;
	}

	// Public methods
	/**
	 * Returns true if application consensus is less than MIN_BROADHASH_CONSENSUS.
	 * Returns false if forgingForce is true.
	 *
	 * @returns {boolean}
	 * @todo Add description for the return value
	 */
	async isPoorConsensus(broadhash) {
		if (this.forgingForce) {
			return false;
		}
		const consensus = await this.calculateConsensus(broadhash);
		return consensus < this.minBroadhashConsensus;
	}
}

// Export
module.exports = {
	Peers,
};
