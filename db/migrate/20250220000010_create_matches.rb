# frozen_string_literal: true

class CreateMatches < ActiveRecord::Migration[7.2]
  def change
    create_table :matches do |t|
      t.string :match_uid, null: false
      t.string :region, null: false
      t.datetime :game_start_at, null: false
      t.integer :year, null: false
      t.jsonb :raw_json, default: {}

      t.timestamps
    end

    add_index :matches, :match_uid, unique: true
    add_index :matches, :year
    add_index :matches, %i[region year]
  end
end
