# frozen_string_literal: true

class CreatePlayers < ActiveRecord::Migration[7.2]
  def change
    create_table :players do |t|
      t.string :puuid, null: false, index: { unique: true }
      t.string :riot_id
      t.string :region

      t.timestamps
    end
  end
end
