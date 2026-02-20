# frozen_string_literal: true

class AddSummonerLevelToPlayers < ActiveRecord::Migration[7.2]
  def change
    add_column :players, :summoner_level, :integer
  end
end
