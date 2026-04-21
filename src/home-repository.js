import { PATHS } from "./constants.js";

export class HomeRepository {
  constructor(customerApi) {
    this.api = customerApi;
  }

  async queryHomes() {
    const response = await this.api.get(PATHS.homes);
    return (response.result ?? []).map((home) => ({
      ...home,
      raw_id: home.id,
      id: home.groupId ?? home.id,
    }));
  }
}
