import type { Db } from 'mongodb'
import type { DocumentUserAdmin, MongoUserInfo } from '@shared/adapter/document-types'

/** MongoDB db-level user administration via createUser/dropUser/usersInfo
 *  commands. The password is used once at createUser time and never stored. */
export class MongoUserAdmin implements DocumentUserAdmin {
  constructor(private readonly dbFor: (name: string) => Db) {}

  async listUsers(db: string): Promise<MongoUserInfo[]> {
    const r = (await this.dbFor(db).command({ usersInfo: 1 })) as {
      users?: { user: string; roles: { role: string; db: string }[] }[]
    }
    return (r.users ?? []).map((u) => ({ user: u.user, roles: u.roles ?? [] }))
  }

  async createUser(db: string, user: string, password: string, roles: string[]): Promise<void> {
    await this.dbFor(db).command({
      createUser: user,
      pwd: password,
      roles: roles.map((role) => ({ role, db }))
    })
  }

  async dropUser(db: string, user: string): Promise<void> {
    await this.dbFor(db).command({ dropUser: user })
  }
}
