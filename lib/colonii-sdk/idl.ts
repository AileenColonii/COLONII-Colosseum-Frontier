/**
 * Generated Anchor IDL for the COLONII identity program.
 *
 * Source: target/idl/colonii_identity.json after anchor build.
 * Do not edit instruction/account shapes by hand; rebuild the program and
 * regenerate this file when the Rust program changes.
 */

export const COLONII_IDL = {
  "address": "E8K8WUxSjEgQAArjT4NkpDxrri59b3SNLVmDCU3yyCCG",
  "metadata": {
    "name": "colonii_identity",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "COLONII on-chain identity layer: DIDs, Verifiable Credentials, and memory anchors on Solana."
  },
  "instructions": [
    {
      "name": "anchor_memory",
      "docs": [
        "Anchor a 32-byte memory hash to the caller's identity, with a",
        "monotonically increasing sequence number. The hash format is",
        "agreed off-chain (sha256/blake3/keccak); the program is opaque."
      ],
      "discriminator": [
        43,
        58,
        132,
        114,
        233,
        207,
        199,
        29
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Owner of the identity. Pays rent for the new memory anchor account."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "identity"
          ]
        },
        {
          "name": "identity",
          "docs": [
            "The identity being anchored to. Must be owned by `owner` and not",
            "inactive. `sequence` is validated against `identity.memory_count`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "anchor",
          "docs": [
            "New memory anchor PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  111,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "identity"
              },
              {
                "kind": "arg",
                "path": "sequence"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "memory_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "sequence",
          "type": "u64"
        }
      ]
    },
    {
      "name": "bind_avatar",
      "docs": [
        "Bind an app-level Supabase UUID/avatar record to the signer's DID."
      ],
      "discriminator": [
        8,
        46,
        86,
        50,
        96,
        156,
        255,
        250
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Owner of the identity. Must sign."
          ],
          "signer": true,
          "relations": [
            "identity"
          ]
        },
        {
          "name": "identity",
          "docs": [
            "Identity receiving the Supabase/avatar binding."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "supabase_uuid",
          "type": "string"
        }
      ]
    },
    {
      "name": "create_issuer",
      "docs": [
        "Register the signer wallet as an active credential issuer."
      ],
      "discriminator": [
        251,
        204,
        188,
        37,
        232,
        43,
        39,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Wallet being registered as an issuer. Must sign and pay rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "issuer",
          "docs": [
            "Issuer registry PDA for the authority wallet."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  115,
                  115,
                  117,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "metadata_uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "deactivate_did",
      "docs": [
        "Mark an identity inactive."
      ],
      "discriminator": [
        241,
        89,
        102,
        174,
        101,
        4,
        65,
        95
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Owner of the identity. Must sign."
          ],
          "signer": true,
          "relations": [
            "identity"
          ]
        },
        {
          "name": "identity",
          "docs": [
            "Identity being marked inactive."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "initialize_did",
      "docs": [
        "Create a fresh identity bound to the signer's wallet and one avatar.",
        "`avatar_code`: 0=Anja, 1=Hung, 2=Grace, 3=Leon."
      ],
      "discriminator": [
        225,
        139,
        116,
        220,
        109,
        255,
        149,
        37
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "The wallet that will own this identity. Must sign and pay for rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "identity",
          "docs": [
            "Newly created identity PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "avatar_code",
          "type": "u8"
        }
      ]
    },
    {
      "name": "issue_credential",
      "docs": [
        "Issue a verifiable credential of `credential_type` to a subject",
        "identity, optionally pointing at off-chain metadata."
      ],
      "discriminator": [
        255,
        193,
        171,
        224,
        68,
        171,
        194,
        87
      ],
      "accounts": [
        {
          "name": "issuer",
          "docs": [
            "Issuer wallet. Pays rent for the credential PDA."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "issuer_registry",
          "docs": [
            "Registered issuer account for the issuer wallet."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  115,
                  115,
                  117,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "issuer"
              }
            ]
          }
        },
        {
          "name": "authority",
          "docs": [
            "because the stored issuer authority is named `authority`."
          ],
          "relations": [
            "issuer_registry"
          ]
        },
        {
          "name": "subject_identity",
          "docs": [
            "The identity receiving the credential. Must exist and not be",
            "inactive."
          ],
          "writable": true
        },
        {
          "name": "credential",
          "docs": [
            "The new credential PDA. Seeded by subject + sha256(type), so each",
            "(subject, type) pair maps to one PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  100,
                  101,
                  110,
                  116,
                  105,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "subject_identity"
              },
              {
                "kind": "arg",
                "path": "credential_type_hash"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "credential_type_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "credential_type",
          "type": "string"
        },
        {
          "name": "metadata_uri",
          "type": "string"
        },
        {
          "name": "expires_at",
          "type": "i64"
        }
      ]
    },
    {
      "name": "revoke_credential",
      "docs": [
        "Revoke a previously issued credential. Only the original issuer",
        "can call this."
      ],
      "discriminator": [
        38,
        123,
        95,
        95,
        223,
        158,
        169,
        87
      ],
      "accounts": [
        {
          "name": "issuer",
          "docs": [
            "Original issuer of the credential. Required signer."
          ],
          "signer": true,
          "relations": [
            "credential"
          ]
        },
        {
          "name": "credential",
          "docs": [
            "The credential being revoked. The `has_one = issuer` constraint",
            "guarantees only the original issuer can revoke."
          ],
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "update_avatar_binding",
      "docs": [
        "Switch which avatar an existing identity is bound to."
      ],
      "discriminator": [
        243,
        79,
        170,
        51,
        144,
        20,
        32,
        156
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Owner of the identity. Must sign."
          ],
          "signer": true,
          "relations": [
            "identity"
          ]
        },
        {
          "name": "identity",
          "docs": [
            "The identity whose avatar binding is being changed.",
            "Validated to be owned by `owner` via the `has_one` constraint."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "avatar_code",
          "type": "u8"
        }
      ]
    },
    {
      "name": "update_did",
      "docs": [
        "Update traits/culture/emotional hashes and metadata URI for a DID."
      ],
      "discriminator": [
        253,
        21,
        4,
        82,
        119,
        227,
        78,
        117
      ],
      "accounts": [
        {
          "name": "owner",
          "docs": [
            "Owner of the identity. Must sign."
          ],
          "signer": true,
          "relations": [
            "identity"
          ]
        },
        {
          "name": "identity",
          "docs": [
            "The identity whose off-chain profile references are being updated."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "traits_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "culture_tags_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "emotional_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "metadata_uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "verify_credential",
      "docs": [
        "Verify on-chain that an identity holds an active credential of",
        "`credential_type`. Errors if not active. Useful for CPI."
      ],
      "discriminator": [
        139,
        189,
        60,
        127,
        32,
        241,
        162,
        134
      ],
      "accounts": [
        {
          "name": "identity",
          "docs": [
            "The identity whose access is being checked."
          ]
        },
        {
          "name": "credential",
          "docs": [
            "The credential to verify. PDA derivation re-checks (subject, type)",
            "binding without trusting the caller's account input."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  100,
                  101,
                  110,
                  116,
                  105,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "identity"
              },
              {
                "kind": "arg",
                "path": "credential_type_hash"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "credential_type_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "credential_type",
          "type": "string"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "Credential",
      "discriminator": [
        145,
        44,
        68,
        220,
        67,
        46,
        100,
        135
      ]
    },
    {
      "name": "Identity",
      "discriminator": [
        58,
        132,
        5,
        12,
        176,
        164,
        85,
        112
      ]
    },
    {
      "name": "Issuer",
      "discriminator": [
        216,
        19,
        83,
        230,
        108,
        53,
        80,
        14
      ]
    },
    {
      "name": "MemoryAnchor",
      "discriminator": [
        43,
        68,
        217,
        159,
        116,
        17,
        255,
        72
      ]
    }
  ],
  "events": [
    {
      "name": "AvatarBound",
      "discriminator": [
        227,
        122,
        127,
        102,
        95,
        160,
        97,
        5
      ]
    },
    {
      "name": "AvatarUpdated",
      "discriminator": [
        112,
        142,
        233,
        158,
        35,
        242,
        220,
        248
      ]
    },
    {
      "name": "CredentialIssued",
      "discriminator": [
        194,
        216,
        28,
        159,
        89,
        29,
        72,
        177
      ]
    },
    {
      "name": "CredentialRevoked",
      "discriminator": [
        127,
        131,
        241,
        234,
        50,
        139,
        145,
        204
      ]
    },
    {
      "name": "CredentialVerified",
      "discriminator": [
        242,
        32,
        25,
        117,
        249,
        65,
        220,
        214
      ]
    },
    {
      "name": "IdentityCreated",
      "discriminator": [
        247,
        185,
        231,
        174,
        133,
        94,
        200,
        142
      ]
    },
    {
      "name": "IdentityDeactivated",
      "discriminator": [
        19,
        21,
        51,
        7,
        82,
        100,
        132,
        255
      ]
    },
    {
      "name": "IdentityUpdated",
      "discriminator": [
        93,
        70,
        231,
        144,
        0,
        172,
        155,
        159
      ]
    },
    {
      "name": "IssuerCreated",
      "discriminator": [
        6,
        119,
        218,
        84,
        12,
        99,
        110,
        226
      ]
    },
    {
      "name": "MemoryAnchored",
      "discriminator": [
        192,
        12,
        4,
        28,
        55,
        59,
        75,
        77
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidAvatarCode",
      "msg": "Avatar code is not in the allowed range."
    },
    {
      "code": 6001,
      "name": "CredentialTypeTooLong",
      "msg": "Credential type string exceeds the 64-byte limit."
    },
    {
      "code": 6002,
      "name": "MetadataUriTooLong",
      "msg": "Metadata URI exceeds the 200-byte limit."
    },
    {
      "code": 6003,
      "name": "CredentialAlreadyRevoked",
      "msg": "Credential is already revoked."
    },
    {
      "code": 6004,
      "name": "CredentialNotActive",
      "msg": "Credential is not active."
    },
    {
      "code": 6005,
      "name": "UnauthorizedIssuer",
      "msg": "Only the original issuer may revoke this credential."
    },
    {
      "code": 6006,
      "name": "UnauthorizedOwner",
      "msg": "Signer does not own this identity."
    },
    {
      "code": 6007,
      "name": "IdentityInactive",
      "msg": "Identity is inactive; operation not allowed."
    },
    {
      "code": 6008,
      "name": "InvalidMemoryHash",
      "msg": "Memory hash must be exactly 32 bytes."
    },
    {
      "code": 6009,
      "name": "ArithmeticOverflow",
      "msg": "Arithmetic overflow."
    },
    {
      "code": 6010,
      "name": "CredentialSubjectMismatch",
      "msg": "Credential subject mismatch with provided identity."
    },
    {
      "code": 6011,
      "name": "SequenceMismatch",
      "msg": "Sequence does not match the identity's memory_count."
    },
    {
      "code": 6012,
      "name": "CredentialTypeHashMismatch",
      "msg": "Credential type hash does not match the credential type string."
    },
    {
      "code": 6013,
      "name": "SupabaseUuidTooLong",
      "msg": "Supabase UUID exceeds the 64-byte limit."
    },
    {
      "code": 6014,
      "name": "IssuerMetadataUriTooLong",
      "msg": "Issuer metadata URI exceeds the 200-byte limit."
    },
    {
      "code": 6015,
      "name": "IssuerInactive",
      "msg": "Issuer is not active."
    },
    {
      "code": 6016,
      "name": "CredentialExpired",
      "msg": "Credential is expired."
    }
  ],
  "types": [
    {
      "name": "Avatar",
      "docs": [
        "The four launch avatars in the COLONII Beta app. Encoded as a fixed-size",
        "enum so account-space accounting stays trivial.",
        "",
        "Adding a new avatar later means appending a variant; never reorder."
      ],
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Anja"
          },
          {
            "name": "Hung"
          },
          {
            "name": "Grace"
          },
          {
            "name": "Leon"
          }
        ]
      }
    },
    {
      "name": "AvatarBound",
      "docs": [
        "Emitted when an app-level avatar/user ID is bound to a DID."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "identity",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "supabase_uuid",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "AvatarUpdated",
      "docs": [
        "Emitted when an identity changes its bound avatar."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "identity",
            "type": "pubkey"
          },
          {
            "name": "previous",
            "type": {
              "defined": {
                "name": "Avatar"
              }
            }
          },
          {
            "name": "current",
            "type": {
              "defined": {
                "name": "Avatar"
              }
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "Credential",
      "docs": [
        "A verifiable credential issued by `issuer` to `subject` (an Identity PDA).",
        "",
        "PDA: seeds = [`seeds::CREDENTIAL`, subject.as_ref(), &type_hash]",
        "where `type_hash = sha256(credential_type)`.",
        "",
        "Constraint: at most one credential of each type per subject. To re-issue",
        "after revocation, close the existing account first (out of scope for the",
        "hackathon demo)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subject",
            "docs": [
              "The Identity PDA the credential is bound to."
            ],
            "type": "pubkey"
          },
          {
            "name": "issuer",
            "docs": [
              "Wallet that issued this credential. Only this key may revoke it."
            ],
            "type": "pubkey"
          },
          {
            "name": "status",
            "docs": [
              "Lifecycle status."
            ],
            "type": {
              "defined": {
                "name": "CredentialStatus"
              }
            }
          },
          {
            "name": "issued_at",
            "docs": [
              "Unix timestamp of issuance."
            ],
            "type": "i64"
          },
          {
            "name": "revoked_at",
            "docs": [
              "Timestamp of revocation (0 if not revoked)."
            ],
            "type": "i64"
          },
          {
            "name": "expires_at",
            "docs": [
              "Expiration timestamp (0 means no expiration)."
            ],
            "type": "i64"
          },
          {
            "name": "type_hash",
            "docs": [
              "SHA-256 of `credential_type`. Stored explicitly so verifiers don't",
              "need to recompute and so the value is auditable on-chain."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "credential_type",
            "docs": [
              "Human-readable credential type (e.g. \"Frontier Hackathon Participant\").",
              "Bounded by `MAX_CREDENTIAL_TYPE_LEN`."
            ],
            "type": "string"
          },
          {
            "name": "metadata_uri",
            "docs": [
              "Optional off-chain metadata pointer (IPFS URI, HTTPS URL, etc.)."
            ],
            "type": "string"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "CredentialIssued",
      "docs": [
        "Emitted when a verifiable credential is issued to an identity."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "credential",
            "type": "pubkey"
          },
          {
            "name": "subject",
            "type": "pubkey"
          },
          {
            "name": "issuer",
            "type": "pubkey"
          },
          {
            "name": "credential_type",
            "type": "string"
          },
          {
            "name": "expires_at",
            "type": "i64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "CredentialRevoked",
      "docs": [
        "Emitted when a verifiable credential is revoked."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "credential",
            "type": "pubkey"
          },
          {
            "name": "subject",
            "type": "pubkey"
          },
          {
            "name": "issuer",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "CredentialStatus",
      "docs": [
        "Verifiable credential lifecycle status."
      ],
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Active"
          },
          {
            "name": "Revoked"
          }
        ]
      }
    },
    {
      "name": "CredentialVerified",
      "docs": [
        "Emitted by the on-chain verify_credential instruction.",
        "Useful for CPI callers and indexing."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "credential",
            "type": "pubkey"
          },
          {
            "name": "subject",
            "type": "pubkey"
          },
          {
            "name": "credential_type",
            "type": "string"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "CredentialStatus"
              }
            }
          },
          {
            "name": "valid",
            "type": "bool"
          },
          {
            "name": "expires_at",
            "type": "i64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "Identity",
      "docs": [
        "The DID account. One per wallet.",
        "",
        "PDA: seeds = [`seeds::IDENTITY`, owner.key().as_ref()]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "Wallet that owns this identity. Required signer for all mutations."
            ],
            "type": "pubkey"
          },
          {
            "name": "avatar",
            "docs": [
              "Currently bound avatar."
            ],
            "type": {
              "defined": {
                "name": "Avatar"
              }
            }
          },
          {
            "name": "status",
            "docs": [
              "Lifecycle status."
            ],
            "type": {
              "defined": {
                "name": "IdentityStatus"
              }
            }
          },
          {
            "name": "created_at",
            "docs": [
              "Unix timestamp of creation."
            ],
            "type": "i64"
          },
          {
            "name": "last_anchor_at",
            "docs": [
              "Timestamp of the most recent memory anchor (0 if none)."
            ],
            "type": "i64"
          },
          {
            "name": "credential_count",
            "docs": [
              "Number of credentials ever issued to this identity (active or revoked)."
            ],
            "type": "u32"
          },
          {
            "name": "memory_count",
            "docs": [
              "Sequence counter for memory anchors. Next anchor uses this value",
              "then increments."
            ],
            "type": "u64"
          },
          {
            "name": "traits_hash",
            "docs": [
              "Hash of traits/profile data stored off-chain."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "culture_tags_hash",
            "docs": [
              "Hash of culture tags stored off-chain."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "emotional_hash",
            "docs": [
              "Hash of emotional profile data stored off-chain."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "metadata_uri",
            "docs": [
              "Optional off-chain profile/lore metadata pointer."
            ],
            "type": "string"
          },
          {
            "name": "supabase_uuid",
            "docs": [
              "Optional Supabase UUID/user identifier bound to this DID."
            ],
            "type": "string"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "IdentityCreated",
      "docs": [
        "Emitted when a new DID/identity is created and bound to a wallet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "identity",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "avatar",
            "type": {
              "defined": {
                "name": "Avatar"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "IdentityStatus"
              }
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "IdentityDeactivated",
      "docs": [
        "Emitted when a DID is deactivated."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "identity",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "IdentityStatus",
      "docs": [
        "User-facing lifecycle status for an identity.",
        "",
        "Vocabulary is intentionally product-friendly (no \"minted\", \"pending_tx\",",
        "etc.) so the SDK can surface it directly to the UI without translation."
      ],
      "repr": {
        "kind": "rust"
      },
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Secured"
          },
          {
            "name": "Active"
          },
          {
            "name": "Inactive"
          }
        ]
      }
    },
    {
      "name": "IdentityUpdated",
      "docs": [
        "Emitted when profile/reference fields on a DID are updated."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "identity",
            "type": "pubkey"
          },
          {
            "name": "traits_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "culture_tags_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "emotional_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "metadata_uri",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "Issuer",
      "docs": [
        "Wallet authority allowed to issue COLONII credentials.",
        "",
        "PDA: seeds = [`seeds::ISSUER`, authority.key().as_ref()]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Wallet registered as the issuing authority."
            ],
            "type": "pubkey"
          },
          {
            "name": "active",
            "docs": [
              "Whether this issuer is active."
            ],
            "type": "bool"
          },
          {
            "name": "metadata_uri",
            "docs": [
              "Optional off-chain metadata pointer for issuer policy/profile."
            ],
            "type": "string"
          },
          {
            "name": "created_at",
            "docs": [
              "Unix timestamp of registration."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "IssuerCreated",
      "docs": [
        "Emitted when a wallet registers as an issuer."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "issuer",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "metadata_uri",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "MemoryAnchor",
      "docs": [
        "A single anchored memory hash.",
        "",
        "Each anchor is its own account, chained off an `Identity` by a monotonic",
        "`sequence` counter. This preserves a verifiable history that the UI can",
        "render as a memory timeline (per the wireframes).",
        "",
        "PDA: seeds = [`seeds::MEMORY`, identity.as_ref(), &sequence.to_le_bytes()]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "identity",
            "docs": [
              "The Identity PDA this anchor belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "docs": [
              "Monotonic sequence number, starting at 0."
            ],
            "type": "u64"
          },
          {
            "name": "memory_hash",
            "docs": [
              "32-byte hash of the off-chain memory record. Format-agnostic",
              "(sha256, blake3, keccak) — the issuer chooses, the chain just",
              "preserves it."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp of the anchor."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "MemoryAnchored",
      "docs": [
        "Emitted on every memory hash anchor."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "identity",
            "type": "pubkey"
          },
          {
            "name": "anchor",
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "memory_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    }
  ]
} as const;
