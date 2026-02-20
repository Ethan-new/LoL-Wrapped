# frozen_string_literal: true

class AddSummonerFieldsToPlayers < ActiveRecord::Migration[7.2]
  def change
    add_column :players, :summoner_id, :string
    add_column :players, :profile_icon_id, :integer
    add_column :players, :revision_date, :bigint
  end
end
