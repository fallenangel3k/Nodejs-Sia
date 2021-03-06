/* eslint-disable no-unused-expressions */
import 'babel-polyfill'
import BigNumber from 'bignumber.js'
import { siacoinsToHastings, hastingsToSiacoins, isRunning, connect, errCouldNotConnect } from '../src/sia.js'
import { expect } from 'chai'
import proxyquire from 'proxyquire'
import { spy } from 'sinon'
import nock from 'nock'
// Mock the process calls required for testing Siad launch functionality.
const mock = {
	'child_process': {
		spawn: spy(),
	},
	'request': spy(),
}
const { launch, call } = proxyquire('../src/sia.js', mock)

BigNumber.config({DECIMAL_PLACES: 28})

const hastingsPerSiacoin = new BigNumber('1000000000000000000000000')

describe('sia.js wrapper library', () => {
	describe('unit conversion functions', () => {
		it('converts from siacoins to hastings correctly', () => {
			const maxSC = new BigNumber('100000000000000000000000')
			for (let i = 0; i < 999; i++) {
				const sc = maxSC.times(Math.trunc(Math.random() * 100000) / 100000)
				const expectedHastings = sc.times(hastingsPerSiacoin)
				expect(siacoinsToHastings(sc).toString()).to.equal(expectedHastings.toString())
			}
		})
		it('converts from hastings to siacoins correctly', () => {
			const maxH = new BigNumber('10').toPower(150)
			for (let i = 0; i < 999; i++) {
				const h = maxH.times(Math.trunc(Math.random() * 100000) / 100000)
				const expectedSiacoins = h.dividedBy(hastingsPerSiacoin)
				expect(hastingsToSiacoins(h).toString()).to.equal(expectedSiacoins.toString())
			}
		})
		it('does not lose precision during unit conversions', () => {
			// convert from base unit -> siacoins n_iter times, comparing the (n_iter-times) converted value at the end.
			// if precision loss were occuring, the original and the converted value would differ.
			const n_iter = 10000
			const originalSiacoin = new BigNumber('1337338498282837188273')
			let convertedSiacoin = originalSiacoin
			for (let i = 0; i < n_iter; i++) {
				convertedSiacoin = hastingsToSiacoins(siacoinsToHastings(convertedSiacoin))
			}
			expect(convertedSiacoin.toString()).to.equal(originalSiacoin.toString())
		})
	})
	describe('siad interaction functions', () => {
		describe('isRunning', () => {
			it('returns true when siad is running', async function() {
				nock('http://localhost:9980')
				  .get('/daemon/version')
				  .reply(200, 'test-version')
				const running = await isRunning('localhost:9980')
				expect(running).to.be.true
			})
			it('returns false when siad is not running', async function() {
				nock('http://localhost:9980')
				  .get('/daemon/version')
				  .replyWithError('error')
				const running = await isRunning('localhost:9980')
				expect(running).to.be.false
			})
		})
		describe('connect', () => {
			it('throws an error if siad is unreachable', async function() {
				nock('http://localhost:9980')
				  .get('/daemon/version')
				  .replyWithError('test-error')
				let didThrow = false
				let err
				try {
					await connect('localhost:9980')
				} catch (e) {
					didThrow = true
					err = e
				}
				expect(didThrow).to.be.true
				expect(err).to.equal(errCouldNotConnect)
			})

			let siad
			it('returns a valid siad object if sia is reachable', async function() {
				nock('http://localhost:9980')
				  .get('/daemon/version')
				  .reply(200, 'test-version')
				siad = await connect('localhost:9980')
				expect(siad).to.have.property('call')
				expect(siad).to.have.property('isRunning')
			})
			it('can make api calls using siad.call', async function() {
				nock('http://localhost:9980')
				  .get('/daemon/version')
				  .reply(200, 'test-version')

				const version = await siad.call('/daemon/version')
				expect(version).to.equal('test-version')
			})
		})
		describe('call', () => {
			afterEach(() => {
				mock['request'].reset()
			})
			it('constructs the correct request options given a string parameter', () => {
				call('localhost:9980', '/test')
				const expectedOpts = {
					url: 'http://localhost:9980/test',
					json: true,
					headers: {
						'User-Agent': 'Sia-Agent',
					},
				}
				expect(mock['request'].getCall(0).args[0]).to.deep.equal(expectedOpts)
			})
			it('constructs the correct request options given an object parameter', () => {
				const testparams = {
					test: 'test',
				}
				call('localhost:9980', {
					url: '/test',
					qs: testparams,
				})
				expect(mock['request'].getCall(0).args[0]).to.have.property('qs')
				expect(mock['request'].getCall(0).args[0].qs).to.deep.equal(testparams)
				expect(mock['request'].getCall(0).args[0].url).to.equal('http://localhost:9980/test')
				expect(mock['request'].getCall(0).args[0].headers).to.deep.equal({
					'User-Agent': 'Sia-Agent',
				})
				expect(mock['request'].getCall(0).args[0].json).to.be.true
			})
		})
		describe('launch', () => {
			afterEach(() => {
				mock['child_process'].spawn.reset()
			})
			it('starts siad with sane defaults if no flags are passed', () => {
				const expectedFlags = [
					'--api-addr=localhost:9980',
					'--host-addr=:9982',
					'--rpc-addr=:9981',
					'--modules=cghmrtw',
				]
				launch('testpath')
				expect(mock['child_process'].spawn.called).to.be.true
				expect(mock['child_process'].spawn.getCall(0).args[1]).to.deep.equal(expectedFlags)
			})
			it('starts siad with --sia-directory given sia-directory', () => {
				const testSettings = {
					'sia-directory': 'testdir',
				}
				launch('testpath', testSettings)
				expect(mock['child_process'].spawn.called).to.be.true
				const flags = mock['child_process'].spawn.getCall(0).args[1]
				const path = mock['child_process'].spawn.getCall(0).args[0]
				expect(flags).to.contain('--sia-directory=testdir')
				expect(path).to.equal('testpath')
			})
			it('sets boolean flags correctly', () => {
				launch('testpath', {'testflag': true})
				const flags = mock['child_process'].spawn.getCall(0).args[1]
				expect(flags.indexOf('--testflag=true') !== -1).to.be.true
				expect(flags.indexOf('--testflag=false') !== -1).to.be.false
			})
			it('starts siad with the same pid as the calling process', () => {
				launch('testpath')
				expect(mock['child_process'].spawn.getCall(0).args[2].uid).to.equal(process.geteuid())
			})
		})
	})
})

/* eslint-enable no-unused-expressions */
