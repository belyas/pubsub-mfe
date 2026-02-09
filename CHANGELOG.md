# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.7.3](https://github.com/belyas/pubsub-mfe/compare/v0.7.2...v0.7.3) (2026-02-09)

### [0.7.2](https://github.com/belyas/pubsub-mfe/compare/v0.7.1...v0.7.2) (2026-02-08)


### Bug Fixes

* **bus:** fix off-by-one error allowing maxHandlersPerTopic+1 ([39cf1a7](https://github.com/belyas/pubsub-mfe/commit/39cf1a7ac674bf452c58be4f2e980483bf783753))
* **iframe-host:** fix potential infinite message loops ([06dc9d4](https://github.com/belyas/pubsub-mfe/commit/06dc9d4bba0f113d9240f53ed6cd08bfe3e77439))
* **retention-buffer:** getMessages double-filtering ([4d0c0ca](https://github.com/belyas/pubsub-mfe/commit/4d0c0ca58a4c79f5b89e4526a4bab64cc5ab1c8b))

### [0.7.1](https://github.com/belyas/pubsub-mfe/compare/v0.7.0...v0.7.1) (2026-02-03)


### Documentation

* **coc:** add code of conduct document ([9226931](https://github.com/belyas/pubsub-mfe/commit/922693144e852a356c267a944436ffb087564f2a))
* **contributing:** add contributing document ([8d441e3](https://github.com/belyas/pubsub-mfe/commit/8d441e3fa01ec14489f425ea489b89cdf3ef7de9))
* **history-adapter:** remove unused jsdoc content ([2054158](https://github.com/belyas/pubsub-mfe/commit/2054158639fbd785bacd5af2e5ce9a3017ead2a7))
* **issue:** add issue templates ([f3d0e72](https://github.com/belyas/pubsub-mfe/commit/f3d0e72e499d1f33296d02bbf0b021952ca08936))
* **pr:** add pull request template ([8ae2774](https://github.com/belyas/pubsub-mfe/commit/8ae2774fcd8db92bfcb2579f84030002ce0791b7))
* **README:** update readme file to include documentation website ([aba2fec](https://github.com/belyas/pubsub-mfe/commit/aba2fec58262c30029970a2609add90de2f798dc))

## [0.7.0](https://github.com/belyas/pubsub-mfe/compare/v0.6.0...v0.7.0) (2026-01-26)


### Features

* add auto selection transport ([2c65949](https://github.com/belyas/pubsub-mfe/commit/2c659496bcd2200ab3d830840f25025ddd203093))
* add shareworked transport ([7883796](https://github.com/belyas/pubsub-mfe/commit/7883796939428f10848796869669ef57aa69d964))
* add storage transport ([945f0ab](https://github.com/belyas/pubsub-mfe/commit/945f0ab6c448b2a1202bf45eca5df6f654a50dd9))
* add worker broker implementation ([057d9c3](https://github.com/belyas/pubsub-mfe/commit/057d9c3e4636544747303f80d0ded80810300f97))
* add worker broker implementation ([287dc54](https://github.com/belyas/pubsub-mfe/commit/287dc54cee3edee4092c5c84132c1eab6627e7b8))

## [0.6.0](https://github.com/belyas/pubsub-mfe/compare/v0.5.0...v0.6.0) (2026-01-23)


### Features

* add indexdb ledger ([da8550a](https://github.com/belyas/pubsub-mfe/commit/da8550a14c7dae414b5860e4e07234896f0d92eb))


### Documentation

* add example application to demonstrate indexdb functionality with the bus ([a558a22](https://github.com/belyas/pubsub-mfe/commit/a558a221c2ff0e0ecd69dd656b609ce6a15bd000))

## [0.5.0](https://github.com/belyas/pubsub-mfe/compare/v0.4.0...v0.5.0) (2026-01-20)


### Features

* add bacthing mechanism and integrate it into the adapter with tests ([d667cd2](https://github.com/belyas/pubsub-mfe/commit/d667cd25b74f9bbb9c4c033c6a257dfbc338ba77))
* add client iframe adapter functionality & add iframes integration tests ([16a7969](https://github.com/belyas/pubsub-mfe/commit/16a796955d54be681bb6a7baab8a22e2f9497009))
* add host iframe adapter functionality ([bc3560b](https://github.com/belyas/pubsub-mfe/commit/bc3560b24b0aaed86428f9aa9f96ceee8a02ae33))

## [0.4.0](https://github.com/belyas/pubsub-mfe/compare/v0.3.0...v0.4.0) (2026-01-16)

## [0.3.0](https://github.com/belyas/pubsub-mfe/compare/v0.2.0...v0.3.0) (2026-01-16)


### Features

* add adapter class ([d1bb36b](https://github.com/belyas/pubsub-mfe/commit/d1bb36ba6dcf867f213596544ca40b47151db0bf))
* add security classes and integrate into adapter ([6fd2181](https://github.com/belyas/pubsub-mfe/commit/6fd218166f8dff1efaa2f61c75884dd112f19fe7))


### Documentation

* add extra scripts example in the readme file ([68d7b7b](https://github.com/belyas/pubsub-mfe/commit/68d7b7b5fe41d4a69b59a978155479808836cd20))

## 0.2.0 (2026-01-10)


### Features

* add schema validation ([4442a52](https://github.com/belyas/pubsub-mfe/commit/4442a52f4254544fc9f3e82871c65d279d7fdf09))
* add subscribe method to bus ([7d7e28b](https://github.com/belyas/pubsub-mfe/commit/7d7e28b0ed4ae92a02fa933f77eaa0b35202d090))
* setup bus impl and create publish method ([5037e21](https://github.com/belyas/pubsub-mfe/commit/5037e215f421951c03a2582dc2f56e21e7b3f485))


### Documentation

* **license:** add year and author owner to license ([945d4e9](https://github.com/belyas/pubsub-mfe/commit/945d4e9fc88d10958c0d1ef9865d73758e5329c4))
* update README file to reflect current implementation ([525821d](https://github.com/belyas/pubsub-mfe/commit/525821d66dcdab44a1be9e0b02062f1d40e75db1))

# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.
